package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/json"
	"encoding/xml"
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
	version       = "0.2.0"
	listenAddress = "127.0.0.1:37654"
	servicePrefix = "HighGAS "
)

type serverRequest struct {
	Server string `json:"server"`
}

type profileRequest struct {
	Server string `json:"server"`
	Config string `json:"config"`
}

type serviceStatus struct {
	Server    string `json:"server"`
	Name      string `json:"name"`
	State     string `json:"state"`
	Connected bool   `json:"connected"`
}

type statusResponse struct {
	Helper       bool            `json:"helper"`
	Version      string          `json:"version"`
	Connected    bool            `json:"connected"`
	ActiveServer string          `json:"activeServer,omitempty"`
	Services     []serviceStatus `json:"services"`
	CheckedAt    string          `json:"checkedAt"`
}

type app struct {
	token string
}

var (
	serverCodePattern      = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{1,39}$`)
	serviceLinePattern     = regexp.MustCompile(`\(([^)]+)\).*"([^"]+)"`)
	configEndpointPattern  = regexp.MustCompile(`(?mi)^\s*Endpoint\s*=\s*([^\s#;]+)\s*$`)
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
	mux.HandleFunc("/v1/install-profile", a.auth(a.installProfile))

	server := &http.Server{
		Addr:              listenAddress,
		Handler:           a.cors(mux),
		ReadHeaderTimeout: 3 * time.Second,
		ReadTimeout:       8 * time.Second,
		WriteTimeout:      15 * time.Second,
		IdleTimeout:       30 * time.Second,
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

func (a *app) installProfile(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"ok": false, "error": "method_not_allowed"})
		return
	}

	var req profileRequest
	decoder := json.NewDecoder(io.LimitReader(r.Body, 96*1024))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "invalid_request"})
		return
	}
	req.Server = strings.TrimSpace(strings.ToLower(req.Server))
	if !serverCodePattern.MatchString(req.Server) {
		writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "invalid_server"})
		return
	}
	if err := validateWireGuardConfig(req.Config); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "invalid_wireguard_config", "detail": err.Error()})
		return
	}

	endpointMatch := configEndpointPattern.FindStringSubmatch(req.Config)
	if len(endpointMatch) != 2 {
		writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "missing_endpoint"})
		return
	}

	profile, err := buildMobileConfig(req.Server, req.Config, endpointMatch[1])
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "error": "profile_build_failed"})
		return
	}

	home, err := os.UserHomeDir()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "error": "home_unavailable"})
		return
	}
	profileDir := filepath.Join(home, "Library", "Application Support", "HighGAS", "profiles")
	if err := os.MkdirAll(profileDir, 0700); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "error": "profile_dir_failed"})
		return
	}
	profilePath := filepath.Join(profileDir, req.Server+".mobileconfig")
	if err := os.WriteFile(profilePath, []byte(profile), 0600); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "error": "profile_write_failed"})
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if out, err := exec.CommandContext(ctx, "/usr/bin/open", profilePath).CombinedOutput(); err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]any{"ok": false, "error": "profile_open_failed", "detail": strings.TrimSpace(string(out))})
		return
	}

	go func(path string) {
		time.Sleep(5 * time.Minute)
		_ = os.Remove(path)
	}(profilePath)

	writeJSON(w, http.StatusAccepted, map[string]any{
		"ok":      true,
		"server":  req.Server,
		"name":    servicePrefix + req.Server,
		"state":   "awaiting_system_install",
	})
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

func validateWireGuardConfig(config string) error {
	if len(config) == 0 || len(config) > 64*1024 {
		return errors.New("config size is invalid")
	}
	required := []string{"[Interface]", "[Peer]", "PrivateKey", "PublicKey", "Endpoint", "AllowedIPs"}
	lower := strings.ToLower(config)
	for _, item := range required {
		if !strings.Contains(lower, strings.ToLower(item)) {
			return fmt.Errorf("missing %s", item)
		}
	}
	return nil
}

func buildMobileConfig(server, config, endpoint string) (string, error) {
	profileUUID, err := newUUID()
	if err != nil {
		return "", err
	}
	vpnUUID, err := newUUID()
	if err != nil {
		return "", err
	}
	name := servicePrefix + server
	identifier := "app.highgas.vpn." + server

	return fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadContent</key>
  <array>
    <dict>
      <key>PayloadDisplayName</key><string>%s</string>
      <key>PayloadIdentifier</key><string>%s.tunnel</string>
      <key>PayloadType</key><string>com.apple.vpn.managed</string>
      <key>PayloadUUID</key><string>%s</string>
      <key>PayloadVersion</key><integer>1</integer>
      <key>UserDefinedName</key><string>%s</string>
      <key>VPNType</key><string>VPN</string>
      <key>VPNSubType</key><string>com.wireguard.macos</string>
      <key>VendorConfig</key>
      <dict>
        <key>WgQuickConfig</key><string>%s</string>
      </dict>
      <key>VPN</key>
      <dict>
        <key>RemoteAddress</key><string>%s</string>
        <key>AuthenticationMethod</key><string>Password</string>
      </dict>
    </dict>
  </array>
  <key>PayloadDisplayName</key><string>%s</string>
  <key>PayloadIdentifier</key><string>%s.profile</string>
  <key>PayloadOrganization</key><string>HighGAS</string>
  <key>PayloadRemovalDisallowed</key><false/>
  <key>PayloadType</key><string>Configuration</string>
  <key>PayloadUUID</key><string>%s</string>
  <key>PayloadVersion</key><integer>1</integer>
</dict>
</plist>
`, xmlEscape(name), identifier, vpnUUID, xmlEscape(name), xmlEscape(config), xmlEscape(endpoint), xmlEscape(name), identifier, profileUUID), nil
}

func xmlEscape(value string) string {
	var buffer bytes.Buffer
	_ = xml.EscapeText(&buffer, []byte(value))
	return buffer.String()
}

func newUUID() (string, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x",
		b[0:4], b[4:6], b[6:8], b[8:10], b[10:16]), nil
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
			Server:    server,
			Name:      name,
			State:     state,
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
