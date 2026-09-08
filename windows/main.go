package main

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/subtle"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	version    = "1.1.1-windows"
	addr       = "127.0.0.1:37654"
	siteURL    = "https://lowgas.vercel.app"
	cookieName = "highgas_session"
)

var codeRE = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{1,39}$`)

type app struct {
	token      string
	base       string
	controller string
	torctl     string
	mu         sync.Mutex
}

type serverReq struct {
	Server string `json:"server"`
}

type torStatus struct {
	Connected bool            `json:"connected"`
	Country   string          `json:"country"`
	Server    string          `json:"server"`
	Started   int64           `json:"started"`
	Checks    map[string]bool `json:"checks"`
}

func programData() string {
	if p := strings.TrimSpace(os.Getenv("ProgramData")); p != "" {
		return p
	}
	return `C:\ProgramData`
}

func main() {
	if runtime.GOOS != "windows" {
		panic("HighGAS Windows helper requires Windows")
	}
	base := filepath.Join(programData(), "HighGAS")
	tokenFile := filepath.Join(base, "helper.token")
	certFile := filepath.Join(base, "certs", "server.crt")
	keyFile := filepath.Join(base, "certs", "server.key")
	controller := filepath.Join(base, "highgas-local-controller.js")
	torctl := filepath.Join(base, "highgas-tor.ps1")
	initCert := false
	for i := 1; i < len(os.Args); i++ {
		switch os.Args[i] {
		case "--init-cert":
			initCert = true
		case "--token-file":
			if i+1 < len(os.Args) {
				i++
				tokenFile = os.Args[i]
			}
		case "--cert-file":
			if i+1 < len(os.Args) {
				i++
				certFile = os.Args[i]
			}
		case "--key-file":
			if i+1 < len(os.Args) {
				i++
				keyFile = os.Args[i]
			}
		case "--controller":
			if i+1 < len(os.Args) {
				i++
				controller = os.Args[i]
			}
		case "--torctl":
			if i+1 < len(os.Args) {
				i++
				torctl = os.Args[i]
			}
		}
	}
	tok, err := ensureToken(tokenFile)
	if err != nil {
		panic(err)
	}
	if err := ensureCertificate(certFile, keyFile); err != nil {
		panic(err)
	}
	if initCert {
		fmt.Println(certFile)
		return
	}
	if _, err := os.Stat(torctl); err == nil {
		_ = runPS(torctl, "recover")
	}

	target, err := url.Parse(siteURL)
	if err != nil {
		panic(err)
	}
	proxy := httputil.NewSingleHostReverseProxy(target)
	originalDirector := proxy.Director
	proxy.Director = func(r *http.Request) {
		originalDirector(r)
		r.Host = target.Host
		r.Header.Del("Origin")
		r.Header.Set("X-HighGAS-Local-Proxy", version)
	}
	proxy.ModifyResponse = func(r *http.Response) error {
		if r.Request != nil && (r.Request.URL.Path == "/" || r.Request.URL.Path == "/index.html") {
			r.Header.Set("Cache-Control", "no-store")
			r.Header.Set("Pragma", "no-cache")
			r.Header.Add("Set-Cookie", cookieName+"="+tok+"; Path=/; Max-Age=31536000; Secure; HttpOnly; SameSite=Strict")
		}
		return nil
	}
	proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, e error) {
		http.Error(w, "HighGAS online interface temporarily unavailable", http.StatusBadGateway)
	}

	a := &app{token: tok, base: base, controller: controller, torctl: torctl}
	mux := http.NewServeMux()
	mux.HandleFunc("/highgas-local-controller.js", a.localController)
	mux.HandleFunc("/api/servers", a.serverCatalog)
	mux.HandleFunc("/api/network-info", a.networkInfo)
	mux.HandleFunc("/v1/health", a.health)
	mux.HandleFunc("/v1/status", a.auth(a.status))
	mux.HandleFunc("/v1/connect", a.auth(a.connect))
	mux.HandleFunc("/v1/disconnect", a.auth(a.disconnect))
	mux.Handle("/", proxy)
	s := &http.Server{Addr: addr, Handler: a.securityHeaders(mux), ReadHeaderTimeout: 3 * time.Second, ReadTimeout: 30 * time.Second, WriteTimeout: 480 * time.Second, IdleTimeout: 60 * time.Second}
	if err := s.ListenAndServeTLS(certFile, keyFile); err != nil && !errors.Is(err, http.ErrServerClosed) {
		panic(err)
	}
}

func ensureToken(path string) (string, error) {
	if b, err := os.ReadFile(path); err == nil {
		t := strings.TrimSpace(string(b))
		if len(t) >= 64 {
			return t, nil
		}
	}
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return "", err
	}
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	t := hex.EncodeToString(b)
	if err := os.WriteFile(path, []byte(t+"\n"), 0600); err != nil {
		return "", err
	}
	return t, nil
}

func ensureCertificate(certFile, keyFile string) error {
	if _, err := os.Stat(certFile); err == nil {
		if _, err := os.Stat(keyFile); err == nil {
			return nil
		}
	}
	if err := os.MkdirAll(filepath.Dir(certFile), 0700); err != nil {
		return err
	}
	key, err := rsa.GenerateKey(rand.Reader, 3072)
	if err != nil {
		return err
	}
	serial, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	if err != nil {
		return err
	}
	now := time.Now().UTC()
	tmpl := x509.Certificate{
		SerialNumber:          serial,
		Subject:               pkix.Name{CommonName: "HighGAS Local Helper"},
		NotBefore:             now.Add(-5 * time.Minute),
		NotAfter:              now.AddDate(10, 0, 0),
		KeyUsage:              x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment | x509.KeyUsageCertSign,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true,
		IsCA:                  true,
		DNSNames:              []string{"localhost"},
		IPAddresses:           []net.IP{net.ParseIP("127.0.0.1")},
	}
	der, err := x509.CreateCertificate(rand.Reader, &tmpl, &tmpl, &key.PublicKey, key)
	if err != nil {
		return err
	}
	cf, err := os.OpenFile(certFile, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0644)
	if err != nil {
		return err
	}
	if err := pem.Encode(cf, &pem.Block{Type: "CERTIFICATE", Bytes: der}); err != nil {
		cf.Close()
		return err
	}
	if err := cf.Close(); err != nil {
		return err
	}
	kb, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		return err
	}
	kf, err := os.OpenFile(keyFile, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0600)
	if err != nil {
		return err
	}
	if err := pem.Encode(kf, &pem.Block{Type: "PRIVATE KEY", Bytes: kb}); err != nil {
		kf.Close()
		return err
	}
	return kf.Close()
}

func localOrigin(o string) bool {
	return o == "https://127.0.0.1:37654" || o == "https://localhost:37654"
}
func (a *app) securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Cache-Control", "no-store")
		if origin := r.Header.Get("Origin"); origin != "" && localOrigin(origin) {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		}
		if r.Method == http.MethodOptions {
			if origin := r.Header.Get("Origin"); origin != "" && !localOrigin(origin) {
				http.Error(w, "origin not allowed", http.StatusForbidden)
				return
			}
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
func (a *app) auth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Sec-Fetch-Site") == "cross-site" {
			out(w, 403, map[string]any{"ok": false, "error": "cross_site_blocked"})
			return
		}
		if origin := r.Header.Get("Origin"); origin != "" && !localOrigin(origin) {
			out(w, 403, map[string]any{"ok": false, "error": "origin_not_allowed"})
			return
		}
		presented := ""
		if c, err := r.Cookie(cookieName); err == nil {
			presented = strings.TrimSpace(c.Value)
		}
		if presented == "" {
			presented = strings.TrimSpace(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "))
		}
		if len(presented) != len(a.token) || subtle.ConstantTimeCompare([]byte(presented), []byte(a.token)) != 1 {
			out(w, 401, map[string]any{"ok": false, "error": "local_session_required"})
			return
		}
		next(w, r)
	}
}
func (a *app) localController(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "method not allowed", 405)
		return
	}
	b, err := os.ReadFile(a.controller)
	if err != nil {
		http.Error(w, "HighGAS local controller missing", 503)
		return
	}
	w.Header().Set("Content-Type", "application/javascript; charset=utf-8")
	if r.Method == http.MethodHead {
		w.WriteHeader(200)
		return
	}
	_, _ = w.Write(b)
}
func (a *app) serverCatalog(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		out(w, 405, map[string]any{"error": "method_not_allowed"})
		return
	}
	out(w, 200, []map[string]any{{"id": 1, "code": "de-fra-01", "country_code": "DE", "country_name": "Alemanha", "city": "Rede Tor", "protocol": "tor", "status": "online", "is_recommended": true, "sort_order": 10}, {"id": 2, "code": "us-mia-01", "country_code": "US", "country_name": "Estados Unidos", "city": "Rede Tor", "protocol": "tor", "status": "online", "is_recommended": false, "sort_order": 20}})
}
func (a *app) torReady() bool {
	for _, p := range []string{a.torctl, filepath.Join(a.base, "tor-expert", "tor", "tor.exe"), filepath.Join(a.base, "sing-box", "sing-box.exe")} {
		if st, err := os.Stat(p); err != nil || st.IsDir() {
			return false
		}
	}
	return true
}
func (a *app) health(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		out(w, 405, map[string]any{"ok": false})
		return
	}
	_, ce := os.Stat(a.controller)
	out(w, 200, map[string]any{"ok": true, "helper": true, "version": version, "platform": "windows", "engine": "highgas-full-tunnel", "torReady": a.torReady(), "controllerReady": ce == nil, "directURL": "https://127.0.0.1:37654/"})
}
func (a *app) readStatus() torStatus {
	var s torStatus
	b, err := runPSOutput(a.torctl, "status-json")
	if err != nil {
		return s
	}
	_ = json.Unmarshal(b, &s)
	return s
}
func (a *app) status(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		out(w, 405, map[string]any{"ok": false})
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	s := a.readStatus()
	resp := map[string]any{"helper": true, "version": version, "platform": "windows", "connected": s.Connected, "torReady": a.torReady(), "torServers": []string{"de-fra-01", "us-mia-01"}, "checkedAt": time.Now().UTC().Format(time.RFC3339), "checks": s.Checks}
	if s.Connected {
		resp["mode"] = "tor"
		resp["country"] = strings.ToUpper(s.Country)
		resp["activeServer"] = s.Server
		if s.Started > 0 {
			resp["connectedAt"] = time.Unix(s.Started, 0).UTC().Format(time.RFC3339)
		}
	}
	out(w, 200, resp)
}
func decodeServer(r *http.Request) (string, error) {
	var q serverReq
	err := json.NewDecoder(io.LimitReader(r.Body, 8192)).Decode(&q)
	q.Server = strings.ToLower(strings.TrimSpace(q.Server))
	if err != nil || !codeRE.MatchString(q.Server) {
		return "", fmt.Errorf("bad server")
	}
	if q.Server != "de-fra-01" && q.Server != "us-mia-01" {
		return "", fmt.Errorf("unsupported server")
	}
	return q.Server, nil
}
func (a *app) connect(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		out(w, 405, map[string]any{"ok": false})
		return
	}
	server, err := decodeServer(r)
	if err != nil {
		out(w, 400, map[string]any{"ok": false, "error": "invalid_server"})
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if !a.torReady() {
		out(w, 503, map[string]any{"ok": false, "error": "tor_not_ready"})
		return
	}
	b, err := runPSOutput(a.torctl, "connect", server)
	if err != nil {
		out(w, 502, map[string]any{"ok": false, "error": "connect_failed", "detail": trimDetail(string(b))})
		return
	}
	s := a.readStatus()
	if !s.Connected || s.Server != server {
		_ = runPS(a.torctl, "disconnect")
		out(w, 502, map[string]any{"ok": false, "error": "verification_failed"})
		return
	}
	out(w, 200, map[string]any{"ok": true, "server": server, "country": s.Country, "checks": s.Checks})
}
func (a *app) disconnect(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		out(w, 405, map[string]any{"ok": false})
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	b, err := runPSOutput(a.torctl, "disconnect")
	if err != nil {
		out(w, 502, map[string]any{"ok": false, "error": "disconnect_failed", "detail": trimDetail(string(b))})
		return
	}
	out(w, 200, map[string]any{"ok": true})
}
func (a *app) networkInfo(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		out(w, 405, map[string]any{"error": "method_not_allowed"})
		return
	}
	client := &http.Client{Timeout: 15 * time.Second}
	req, _ := http.NewRequest(http.MethodGet, siteURL+"/api/network-info?ts="+strconv.FormatInt(time.Now().UnixNano(), 10), nil)
	req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		out(w, 502, map[string]any{"error": "network_check_failed"})
		return
	}
	defer resp.Body.Close()
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	_, _ = io.CopyN(w, resp.Body, 1<<20)
}
func runPS(script string, args ...string) error { _, err := runPSOutput(script, args...); return err }
func runPSOutput(script string, args ...string) ([]byte, error) {
	psArgs := []string{"-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script}
	psArgs = append(psArgs, args...)

	// Do not use CombinedOutput here. highgas-tor.ps1 intentionally starts
	// long-lived Tor/sing-box children; on Windows inherited stdout/stderr pipe
	// handles can keep os/exec waiting after PowerShell itself has exited.
	// A real file gives PowerShell a non-pipe handle, so Run waits only for the
	// controller process while we can still return its diagnostics to the API.
	f, err := os.CreateTemp("", "highgas-ps-*.log")
	if err != nil {
		return nil, err
	}
	name := f.Name()
	defer os.Remove(name)

	cmd := exec.Command("powershell.exe", psArgs...)
	cmd.Stdout = f
	cmd.Stderr = f
	runErr := cmd.Run()
	closeErr := f.Close()
	b, readErr := os.ReadFile(name)
	if runErr != nil {
		return b, runErr
	}
	if closeErr != nil {
		return b, closeErr
	}
	if readErr != nil {
		return b, readErr
	}
	return b, nil
}
func trimDetail(s string) string {
	s = strings.TrimSpace(s)
	if len(s) > 2000 {
		s = s[len(s)-2000:]
	}
	return s
}
func out(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
