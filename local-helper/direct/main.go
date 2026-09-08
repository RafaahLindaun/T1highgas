package main

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	version         = "1.0.0"
	addr            = "127.0.0.1:37654"
	base            = "/Library/Application Support/HighGAS"
	profiles        = base + "/profiles"
	tunnel          = base + "/highgas-tunnel"
	torctl          = base + "/highgas-tor"
	torBin          = base + "/tor-expert/tor/tor"
	controllerAsset = base + "/highgas-local-controller.js"
	siteURL         = "https://lowgas.vercel.app"
	cookieName      = "highgas_session"
)

var codeRE = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{1,39}$`)

type app struct {
	token string
	mu    sync.Mutex
}

type serverReq struct {
	Server string `json:"server"`
}

type profileReq struct {
	Server string `json:"server"`
	Config string `json:"config"`
}

func main() {
	if os.Geteuid() != 0 {
		panic("HighGAS helper must run as root")
	}

	tokenFile := base + "/helper.token"
	certFile := base + "/certs/server.crt"
	keyFile := base + "/certs/server.key"
	for i := 1; i < len(os.Args); i++ {
		switch os.Args[i] {
		case "--token-file":
			if i+1 < len(os.Args) {
				tokenFile = os.Args[i+1]
				i++
			}
		case "--cert-file":
			if i+1 < len(os.Args) {
				certFile = os.Args[i+1]
				i++
			}
		case "--key-file":
			if i+1 < len(os.Args) {
				keyFile = os.Args[i+1]
				i++
			}
		}
	}

	b, err := os.ReadFile(tokenFile)
	if err != nil {
		panic(err)
	}
	tok := strings.TrimSpace(string(b))
	if len(tok) < 32 {
		panic("invalid helper token")
	}
	if _, err := os.Stat(certFile); err != nil {
		panic("HighGAS TLS certificate is missing")
	}
	if _, err := os.Stat(keyFile); err != nil {
		panic("HighGAS TLS private key is missing")
	}

	if _, err := os.Stat(torctl); err == nil {
		_ = exec.Command(torctl, "recover").Run()
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
		if r.Request != nil {
			p := r.Request.URL.Path
			if p == "/" || p == "/index.html" {
				r.Header.Set("Cache-Control", "no-store")
				r.Header.Set("Pragma", "no-cache")
				r.Header.Add("Set-Cookie", cookieName+"="+tok+"; Path=/; Max-Age=31536000; Secure; HttpOnly; SameSite=Strict")
			}
		}
		return nil
	}
	proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, e error) {
		http.Error(w, "HighGAS online interface temporarily unavailable", http.StatusBadGateway)
	}

	_ = os.MkdirAll(profiles, 0700)
	a := &app{token: tok}
	mux := http.NewServeMux()
	mux.HandleFunc("/highgas-local-controller.js", a.localController)
	mux.HandleFunc("/api/servers", a.serverCatalog)
	mux.HandleFunc("/api/network-info", a.networkInfo)
	mux.HandleFunc("/v1/health", a.health)
	mux.HandleFunc("/v1/status", a.auth(a.status))
	mux.HandleFunc("/v1/install-profile", a.auth(a.install))
	mux.HandleFunc("/v1/connect", a.auth(a.connect))
	mux.HandleFunc("/v1/disconnect", a.auth(a.disconnect))
	mux.Handle("/", proxy)

	s := &http.Server{
		Addr:              addr,
		Handler:           a.securityHeaders(mux),
		ReadHeaderTimeout: 3 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      260 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
	if err := s.ListenAndServeTLS(certFile, keyFile); err != nil && !errors.Is(err, http.ErrServerClosed) {
		panic(err)
	}
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
		if site := r.Header.Get("Sec-Fetch-Site"); site == "cross-site" {
			out(w, http.StatusForbidden, map[string]any{"ok": false, "error": "cross_site_blocked"})
			return
		}
		if origin := r.Header.Get("Origin"); origin != "" && !localOrigin(origin) {
			out(w, http.StatusForbidden, map[string]any{"ok": false, "error": "origin_not_allowed"})
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
			out(w, http.StatusUnauthorized, map[string]any{"ok": false, "error": "local_session_required"})
			return
		}
		next(w, r)
	}
}

func (a *app) localController(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	b, err := os.ReadFile(controllerAsset)
	if err != nil {
		http.Error(w, "HighGAS local controller missing", http.StatusServiceUnavailable)
		return
	}
	w.Header().Set("Content-Type", "application/javascript; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	if r.Method == http.MethodHead {
		w.WriteHeader(http.StatusOK)
		return
	}
	_, _ = w.Write(b)
}

func (a *app) serverCatalog(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		out(w, http.StatusMethodNotAllowed, map[string]any{"error": "method_not_allowed"})
		return
	}
	w.Header().Set("X-HighGAS-Source", "local-tor")
	out(w, http.StatusOK, []map[string]any{
		{"id": 1, "code": "de-fra-01", "country_code": "DE", "country_name": "Alemanha", "city": "Rede Tor", "protocol": "tor", "status": "online", "is_recommended": true, "sort_order": 10},
		{"id": 2, "code": "us-mia-01", "country_code": "US", "country_name": "Estados Unidos", "city": "Rede Tor", "protocol": "tor", "status": "online", "is_recommended": false, "sort_order": 20},
	})
}

func torAvailable() bool {
	for _, p := range []string{torctl, torBin} {
		info, err := os.Stat(p)
		if err != nil || info.IsDir() || info.Mode()&0111 == 0 {
			return false
		}
	}
	return true
}

func torCountryForServer(server string) (string, bool) {
	switch server {
	case "de-fra-01":
		return "DE", true
	case "us-mia-01":
		return "US", true
	default:
		return "", false
	}
}

func readTorStatus() (connected bool, country, server, startedAt string) {
	if !torAvailable() {
		return false, "", "", ""
	}
	b, err := exec.Command(torctl, "status").CombinedOutput()
	if err != nil {
		return false, "", "", ""
	}
	f := strings.Fields(string(b))
	if len(f) >= 5 && f[0] == "connected" && f[1] == "tor" {
		return true, strings.ToUpper(f[2]), f[3], f[4]
	}
	return false, "", "", ""
}

func startedISO(epoch string) string {
	v, err := strconv.ParseInt(epoch, 10, 64)
	if err != nil || v <= 0 {
		return ""
	}
	return time.Unix(v, 0).UTC().Format(time.RFC3339)
}

func (a *app) health(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		out(w, http.StatusMethodNotAllowed, map[string]any{"ok": false})
		return
	}
	_, te := os.Stat(tunnel)
	_, we := os.Stat(base + "/wireguard-go")
	_, ce := os.Stat(controllerAsset)
	out(w, http.StatusOK, map[string]any{
		"ok":              true,
		"helper":          true,
		"version":         version,
		"transport":       "https-local-cookie",
		"engine":          "highgas-full-tunnel",
		"engineReady":     te == nil && we == nil,
		"torReady":        torAvailable(),
		"controllerReady": ce == nil,
		"directURL":       "https://127.0.0.1:37654/",
	})
}

func (a *app) status(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		out(w, http.StatusMethodNotAllowed, map[string]any{"ok": false})
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()

	ps, _ := profileList()
	resp := map[string]any{
		"helper":     true,
		"version":    version,
		"connected":  false,
		"profiles":   ps,
		"torReady":   torAvailable(),
		"torServers": []string{"de-fra-01", "us-mia-01"},
		"checkedAt":  time.Now().UTC().Format(time.RFC3339),
	}
	if connected, country, server, started := readTorStatus(); connected {
		resp["connected"] = true
		resp["mode"] = "tor"
		resp["country"] = country
		resp["activeServer"] = server
		resp["connectedAt"] = startedISO(started)
		out(w, http.StatusOK, resp)
		return
	}

	b, _ := exec.Command(tunnel, "status").CombinedOutput()
	f := strings.Fields(string(b))
	if len(f) >= 3 && f[0] == "connected" {
		resp["connected"] = true
		resp["mode"] = "wireguard"
		resp["activeServer"] = f[1]
		resp["interface"] = f[2]
	}
	out(w, http.StatusOK, resp)
}

func (a *app) install(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		out(w, http.StatusMethodNotAllowed, map[string]any{"ok": false})
		return
	}
	var q profileReq
	if json.NewDecoder(io.LimitReader(r.Body, 96<<10)).Decode(&q) != nil {
		out(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "invalid_request"})
		return
	}
	q.Server = strings.ToLower(strings.TrimSpace(q.Server))
	if !codeRE.MatchString(q.Server) || !validWG(q.Config) {
		out(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "invalid_wireguard_config"})
		return
	}
	if err := os.WriteFile(filepath.Join(profiles, q.Server+".conf"), []byte(strings.TrimSpace(q.Config)+"\n"), 0600); err != nil {
		out(w, http.StatusInternalServerError, map[string]any{"ok": false, "error": "profile_write_failed"})
		return
	}
	out(w, http.StatusCreated, map[string]any{"ok": true, "server": q.Server})
}

func decodeServer(r *http.Request) (serverReq, error) {
	var q serverReq
	err := json.NewDecoder(io.LimitReader(r.Body, 8192)).Decode(&q)
	q.Server = strings.ToLower(strings.TrimSpace(q.Server))
	if err != nil || !codeRE.MatchString(q.Server) {
		return q, fmt.Errorf("bad server")
	}
	return q, nil
}

func (a *app) connect(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		out(w, http.StatusMethodNotAllowed, map[string]any{"ok": false})
		return
	}
	q, err := decodeServer(r)
	if err != nil {
		out(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "invalid_request"})
		return
	}

	if _, ok := torCountryForServer(q.Server); ok {
		if !torAvailable() {
			out(w, http.StatusConflict, map[string]any{"ok": false, "error": "tor_not_installed"})
			return
		}
		a.mu.Lock()
		defer a.mu.Unlock()
		_ = exec.Command(tunnel, "down").Run()
		ctx, cancel := context.WithTimeout(context.Background(), 240*time.Second)
		defer cancel()
		b, err := exec.CommandContext(ctx, torctl, "up", q.Server).CombinedOutput()
		if ctx.Err() != nil {
			_ = exec.Command(torctl, "down").Run()
			out(w, http.StatusGatewayTimeout, map[string]any{"ok": false, "error": "tor_timeout", "detail": "Tor demorou demais para conectar"})
			return
		}
		if err != nil {
			out(w, http.StatusBadGateway, map[string]any{"ok": false, "error": "tor_connect_failed", "detail": strings.TrimSpace(string(b))})
			return
		}
		out(w, http.StatusAccepted, map[string]any{"ok": true, "server": q.Server, "mode": "tor", "state": "connected"})
		return
	}

	if _, err := os.Stat(filepath.Join(profiles, q.Server+".conf")); err != nil {
		out(w, http.StatusConflict, map[string]any{"ok": false, "error": "profile_not_installed"})
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if torAvailable() {
		_ = exec.Command(torctl, "down").Run()
	}
	b, err := exec.Command(tunnel, "up", q.Server).CombinedOutput()
	if err != nil {
		out(w, http.StatusBadGateway, map[string]any{"ok": false, "error": "connect_failed", "detail": strings.TrimSpace(string(b))})
		return
	}
	out(w, http.StatusAccepted, map[string]any{"ok": true, "server": q.Server, "mode": "wireguard", "state": "connected"})
}

func (a *app) disconnect(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		out(w, http.StatusMethodNotAllowed, map[string]any{"ok": false})
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	var details []string
	if torAvailable() {
		if b, err := exec.Command(torctl, "down").CombinedOutput(); err != nil {
			details = append(details, strings.TrimSpace(string(b)))
		}
	}
	if b, err := exec.Command(tunnel, "down").CombinedOutput(); err != nil {
		details = append(details, strings.TrimSpace(string(b)))
	}
	if len(details) > 0 {
		out(w, http.StatusBadGateway, map[string]any{"ok": false, "error": "disconnect_failed", "detail": strings.Join(details, "; ")})
		return
	}
	out(w, http.StatusOK, map[string]any{"ok": true, "state": "disconnected"})
}

func (a *app) networkInfo(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		out(w, http.StatusMethodNotAllowed, map[string]any{"error": "method_not_allowed"})
		return
	}
	target := siteURL + "/api/network-info"
	if r.URL.RawQuery != "" {
		target += "?" + r.URL.RawQuery
	}

	a.mu.Lock()
	torConnected, _, _, _ := readTorStatus()
	a.mu.Unlock()
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	if torConnected {
		ctx, cancel := context.WithTimeout(r.Context(), 18*time.Second)
		defer cancel()
		b, err := exec.CommandContext(ctx, "/usr/bin/curl", "-fsS", "--max-time", "15", "--socks5-hostname", "127.0.0.1:39050", "-H", "Accept: application/json", target).CombinedOutput()
		if err != nil {
			out(w, http.StatusBadGateway, map[string]any{"error": "tor_network_check_failed"})
			return
		}
		_, _ = w.Write(b)
		return
	}

	client := &http.Client{Timeout: 12 * time.Second, Transport: &http.Transport{Proxy: nil}}
	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, target, nil)
	if err != nil {
		out(w, http.StatusInternalServerError, map[string]any{"error": "network_request_failed"})
		return
	}
	req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		out(w, http.StatusBadGateway, map[string]any{"error": "network_check_failed"})
		return
	}
	defer resp.Body.Close()
	w.WriteHeader(resp.StatusCode)
	_, _ = io.Copy(w, io.LimitReader(resp.Body, 64<<10))
}

func validWG(s string) bool {
	if len(s) < 40 || len(s) > 64<<10 {
		return false
	}
	x := strings.ToLower(s)
	for _, k := range []string{"[interface]", "privatekey", "address", "[peer]", "publickey", "endpoint", "allowedips"} {
		if !strings.Contains(x, k) {
			return false
		}
	}
	return true
}

func profileList() ([]string, error) {
	entries, err := os.ReadDir(profiles)
	if err != nil {
		return nil, err
	}
	var outList []string
	for _, e := range entries {
		name := strings.TrimSuffix(e.Name(), ".conf")
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".conf") && codeRE.MatchString(name) {
			outList = append(outList, name)
		}
	}
	return outList, nil
}

func out(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
