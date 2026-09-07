package main

import (
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

const (
	version  = "0.4.0"
	addr     = "127.0.0.1:37654"
	base     = "/Library/Application Support/HighGAS"
	profiles = base + "/profiles"
	tunnel   = base + "/highgas-tunnel"
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

	tf := base + "/helper.token"
	certFile := base + "/certs/server.crt"
	keyFile := base + "/certs/server.key"

	for i := 1; i < len(os.Args); i++ {
		switch os.Args[i] {
		case "--token-file":
			if i+1 < len(os.Args) {
				tf = os.Args[i+1]
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

	b, err := os.ReadFile(tf)
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

	_ = os.MkdirAll(profiles, 0700)
	a := &app{token: tok}
	m := http.NewServeMux()
	m.HandleFunc("/v1/health", a.health)
	m.HandleFunc("/v1/status", a.auth(a.status))
	m.HandleFunc("/v1/install-profile", a.auth(a.install))
	m.HandleFunc("/v1/connect", a.auth(a.connect))
	m.HandleFunc("/v1/disconnect", a.auth(a.disconnect))

	s := &http.Server{
		Addr:              addr,
		Handler:           a.cors(m),
		ReadHeaderTimeout: 3 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      15 * time.Second,
		IdleTimeout:       30 * time.Second,
	}

	if err := s.ListenAndServeTLS(certFile, keyFile); err != nil && !errors.Is(err, http.ErrServerClosed) {
		panic(err)
	}
}

func allowedOrigin(o string) bool {
	return o == "https://lowgas.vercel.app" ||
		o == "https://t1highgas.vercel.app" ||
		(strings.HasPrefix(o, "https://") && strings.HasSuffix(o, ".vercel.app")) ||
		strings.HasPrefix(o, "http://localhost:") ||
		strings.HasPrefix(o, "http://127.0.0.1:") ||
		strings.HasPrefix(o, "https://localhost:") ||
		strings.HasPrefix(o, "https://127.0.0.1:")
}

func (a *app) cors(n http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		o := r.Header.Get("Origin")
		if o != "" && allowedOrigin(o) {
			w.Header().Set("Access-Control-Allow-Origin", o)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-HighGAS-Token")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
			w.Header().Set("Access-Control-Allow-Private-Network", "true")
		}
		if r.Method == http.MethodOptions {
			if o == "" || !allowedOrigin(o) {
				http.Error(w, "origin not allowed", http.StatusForbidden)
				return
			}
			w.WriteHeader(http.StatusNoContent)
			return
		}
		n.ServeHTTP(w, r)
	})
}

func (a *app) auth(n http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		p := strings.TrimSpace(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "))
		if p == "" {
			p = strings.TrimSpace(r.Header.Get("X-HighGAS-Token"))
		}
		if len(p) != len(a.token) || subtle.ConstantTimeCompare([]byte(p), []byte(a.token)) != 1 {
			out(w, http.StatusUnauthorized, map[string]any{"ok": false, "error": "unauthorized"})
			return
		}
		n(w, r)
	}
}

func (a *app) health(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		out(w, http.StatusMethodNotAllowed, map[string]any{"ok": false})
		return
	}
	_, te := os.Stat(tunnel)
	_, we := os.Stat(base + "/wireguard-go")
	out(w, http.StatusOK, map[string]any{
		"ok":          true,
		"helper":      true,
		"version":     version,
		"transport":   "https",
		"engine":      "wireguard-go",
		"engineReady": te == nil && we == nil,
	})
}

func (a *app) status(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		out(w, http.StatusMethodNotAllowed, map[string]any{"ok": false})
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	b, _ := exec.Command(tunnel, "status").CombinedOutput()
	f := strings.Fields(string(b))
	connected := len(f) >= 3 && f[0] == "connected"
	ps, _ := profileList()
	resp := map[string]any{
		"helper":    true,
		"version":   version,
		"transport": "https",
		"connected": connected,
		"profiles":  ps,
		"checkedAt": time.Now().UTC().Format(time.RFC3339),
	}
	if connected {
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
	out(w, http.StatusCreated, map[string]any{"ok": true, "server": q.Server, "state": "installed_locally"})
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
	if _, err = os.Stat(filepath.Join(profiles, q.Server+".conf")); err != nil {
		out(w, http.StatusConflict, map[string]any{"ok": false, "error": "profile_not_installed", "server": q.Server})
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	b, err := exec.Command(tunnel, "up", q.Server).CombinedOutput()
	if err != nil {
		out(w, http.StatusBadGateway, map[string]any{"ok": false, "error": "connect_failed", "detail": strings.TrimSpace(string(b))})
		return
	}
	out(w, http.StatusAccepted, map[string]any{"ok": true, "server": q.Server, "state": "connected"})
}

func (a *app) disconnect(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		out(w, http.StatusMethodNotAllowed, map[string]any{"ok": false})
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	b, err := exec.Command(tunnel, "down").CombinedOutput()
	if err != nil {
		out(w, http.StatusBadGateway, map[string]any{"ok": false, "error": "disconnect_failed", "detail": strings.TrimSpace(string(b))})
		return
	}
	out(w, http.StatusOK, map[string]any{"ok": true, "stopped": 1})
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
	es, err := os.ReadDir(profiles)
	if err != nil {
		return nil, err
	}
	var r []string
	for _, x := range es {
		n := strings.TrimSuffix(x.Name(), ".conf")
		if !x.IsDir() && strings.HasSuffix(x.Name(), ".conf") && codeRE.MatchString(n) {
			r = append(r, n)
		}
	}
	return r, nil
}

func out(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
