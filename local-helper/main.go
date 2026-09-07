package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

const (
	version = "0.1.0"
	listenAddress = "127.0.0.1:37654"
	servicePrefix = "HighGAS "
)

type serverRequest struct {
	Server string `json:"server"`
}

type serviceStatus struct {
	Server string `json:"server"`
	Name string `json:"name"`
	State string `json:"state"`
	Connected bool `json:"connected"`
}

type statusResponse struct {
	Helper bool `json:"helper"`
	Version string `json:"version"`
	Connected bool `json:"connected"`
	ActiveServer string `json:"activeServer,omitempty"`
	Services []serviceStatus `json:"services"`
	CheckedAt string `json:"checkedAt"`
}

type app struct {
	token string
}

var (
	serverCodePattern = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{1,39}$`)
	serviceLinePattern = regexp.MustCompile(`\(([^)]+)\).*"([^"]+)"`)
)

func main() {
	tokenFile := defaultTokenFile()
	for i := 1; i < len(os.Args); i++ {
		if os.Args[i] == "--token-file" && i+1 < len(os.Args) {
			tokenFile = os.Args[i+1]
			i++
		}
	}

	rawToken, err := os.ReadFile(tokenFile)
	if err != nil {
		log.Fatalf("cannot read token file %s: %v", tokenFile, err)
	}
	token := strings.TrimSpace(string(rawToken))
	if len(token) < 24 {
		log.Fatal("helper token is missing or too short")
	}

	a := &app{token: token}
	mux := http.NewServeMux()
	mux.HandleFunc("/v1/health", a.health)
	mux.HandleFunc("/v1/status", a.auth(a.status))
	mux.HandleFunc("/v1/connect", a.auth(a.connect))
	mux.HandleFunc("/v1/disconnect", a.auth(a.disconnect))

	server := &http.Server{
		Addr: listenAddress,
		Handler: a.cors(mux),
		ReadHeaderTimeout: 3 * time.Second,
		ReadTimeout: 6 * time.Second,
		WriteTimeout: 12 * time.Second,
		IdleTimeout: 30 * time.Second,
	}

	log.Printf("HighGAS helper %s listening on http://%s", version, listenAddress)
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}

func defaultTokenFile() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return "helper.token"
	}
	return filepath.Join(home, "Library", "Application Support", "HighGAS", "helper.token")
}

func (a *app) cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" && originAllowed(origin) {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-HighGAS-Token")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		}
		if r.Method == http.MethodOptions {
			if origin == "" || !originAllowed(origin) {
				http.Error(w, "origin not allowed", http.StatusForbidden)
				return
			}
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func originAllowed(origin string) bool {
	if origin == "https://lowgas.vercel.app" || origin == "https://t1highgas.vercel.app" {
		return true
	}
	if strings.HasPrefix(origin, "http://localhost:") || strings.HasPrefix(origin, "http://127.0.0.1:") {
		return true
	}
	return strings.HasPrefix(origin, "https://") && strings.HasSuffix(origin, ".vercel.app")
}

func (a *app) auth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		provided := strings.TrimSpace(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "))
		if provided == "" {
			provided = strings.TrimSpace(r.Header.Get("X-HighGAS-Token"))
		}
		if provided == "" || provided != a.token {
			writeJSON(w, http.StatusUnauthorized, map[string]any{"ok": false, "error": "unauthorized"})
			return
		}
		next(w, r)
	}
}

func (a *app) health(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"ok": false, "error": "method_not_allowed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "helper": true, "version": version})
}

func (a *app) status(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"ok": false, "error": "method_not_allowed"})
		return
	}
	services, err := listHighGASServices()
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]any{"ok": false, "error": "scutil_failed", "detail": err.Error()})
		return
	}

	response := statusResponse{Helper: true, Version: version, Services: services, CheckedAt: time.Now().UTC().Format(time.RFC3339)}
	for _, service := range services {
		if service.Connected {
			response.Connected = true
			response.ActiveServer = service.Server
			break
		}
	}
	writeJSON(w, http.StatusOK, response)
}

func (a *app) connect(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"ok": false, "error": "method_not_allowed"})
		return
	}
	req, err := decodeServerRequest(r)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "invalid_request"})
		return
	}

	services, err := listHighGASServices()
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]any{"ok": false, "error": "scutil_failed", "detail": err.Error()})
		return
	}

	wanted := servicePrefix + req.Server
	found := false
	for _, service := range services {
		if service.Name == wanted {
			found = true
			continue
		}
		if service.Connected {
			_ = runScutil("--nc", "stop", service.Name)
		}
	}
	if !found {
		writeJSON(w, http.StatusConflict, map[string]any{"ok": false, "error": "profile_not_installed", "server": req.Server})
		return
	}

	if err := runScutil("--nc", "start", wanted); err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]any{"ok": false, "error": "connect_failed", "detail": err.Error()})
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]any{"ok": true, "server": req.Server, "state": "connecting"})
}

func (a *app) disconnect(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"ok": false, "error": "method_not_allowed"})
		return
	}

	var req serverRequest
	body, _ := io.ReadAll(io.LimitReader(r.Body, 8192))
	if len(strings.TrimSpace(string(body))) > 0 {
		if err := json.Unmarshal(body, &req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "invalid_request"})
			return
		}
		if req.Server != "" && !serverCodePattern.MatchString(req.Server) {
			writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "invalid_server"})
			return
		}
	}

	services, err := listHighGASServices()
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]any{"ok": false, "error": "scutil_failed", "detail": err.Error()})
		return
	}

	stopped := 0
	for _, service := range services {
		if req.Server != "" && service.Server != req.Server {
			continue
		}
		if service.Connected || strings.EqualFold(service.State, "Connecting") {
			if err := runScutil("--nc", "stop", service.Name); err == nil {
				stopped++
			}
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "stopped": stopped})
}

func decodeServerRequest(r *http.Request) (serverRequest, error) {
	var req serverRequest
	decoder := json.NewDecoder(io.LimitReader(r.Body, 8192))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&req); err != nil {
		return req, err
	}
	req.Server = strings.TrimSpace(strings.ToLower(req.Server))
	if !serverCodePattern.MatchString(req.Server) {
		return req, errors.New("invalid server")
	}
	return req, nil
}

func listHighGASServices() ([]serviceStatus, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "/usr/sbin/scutil", "--nc", "list").CombinedOutput()
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	if err != nil {
		return nil, fmt.Errorf("%v: %s", err, strings.TrimSpace(string(out)))
	}

	services := make([]serviceStatus, 0)
	for _, line := range strings.Split(string(out), "\n") {
		match := serviceLinePattern.FindStringSubmatch(line)
		if len(match) != 3 {
			continue
		}
		state := strings.TrimSpace(match[1])
		name := strings.TrimSpace(match[2])
		if !strings.HasPrefix(name, servicePrefix) {
			continue
		}
		server := strings.TrimPrefix(name, servicePrefix)
		services = append(services, serviceStatus{
			Server: server,
			Name: name,
			State: state,
			Connected: strings.EqualFold(state, "Connected"),
		})
	}
	return services, nil
}

func runScutil(args ...string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "/usr/sbin/scutil", args...).CombinedOutput()
	if ctx.Err() != nil {
		return ctx.Err()
	}
	if err != nil {
		return fmt.Errorf("%v: %s", err, strings.TrimSpace(string(out)))
	}
	return nil
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
