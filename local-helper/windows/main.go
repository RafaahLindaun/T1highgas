package main

import (
    "context"
    "crypto/rand"
    "crypto/subtle"
    "encoding/hex"
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
    version = "2.0.0"
    addr = "127.0.0.1:37654"
    siteURL = "https://lowgas.vercel.app"
    cookieName = "highgas_session"
)

var codeRE = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{1,39}$`)

type app struct {
    token string
    base string
    engine string
    controller string
    mu sync.Mutex
}

type serverReq struct { Server string `json:"server"` }

func programData() string {
    if v := strings.TrimSpace(os.Getenv("ProgramData")); v != "" { return v }
    return `C:\ProgramData`
}

func baseDir() string { return filepath.Join(programData(), "HighGAS") }

func main() {
    base := baseDir()
    tokenFile := filepath.Join(base, "helper.token")
    for i := 1; i < len(os.Args); i++ {
        if os.Args[i] == "--token-file" && i+1 < len(os.Args) {
            tokenFile = os.Args[i+1]; i++
        }
    }
    b, err := os.ReadFile(tokenFile)
    if err != nil { panic(err) }
    tok := strings.TrimSpace(string(b))
    if len(tok) < 32 { panic("invalid helper token") }

    engine := filepath.Join(base, "highgas-tor.ps1")
    controller := filepath.Join(base, "highgas-local-controller.js")
    if _, err := os.Stat(engine); err == nil { _ = runEngine(base, engine, "recover", "", 45*time.Second) }

    target, err := url.Parse(siteURL)
    if err != nil { panic(err) }
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
                r.Header.Add("Set-Cookie", cookieName+"="+tok+"; Path=/; Max-Age=31536000; HttpOnly; SameSite=Strict")
            }
        }
        return nil
    }
    proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, e error) {
        http.Error(w, "HighGAS online interface temporarily unavailable", http.StatusBadGateway)
    }

    a := &app{token: tok, base: base, engine: engine, controller: controller}
    mux := http.NewServeMux()
    mux.HandleFunc("/highgas-local-controller.js", a.localController)
    mux.HandleFunc("/api/servers", a.serverCatalog)
    mux.HandleFunc("/api/network-info", a.networkInfo)
    mux.HandleFunc("/v1/health", a.health)
    mux.HandleFunc("/v1/status", a.auth(a.status))
    mux.HandleFunc("/v1/connect", a.auth(a.connect))
    mux.HandleFunc("/v1/disconnect", a.auth(a.disconnect))
    mux.Handle("/", proxy)

    s := &http.Server{Addr: addr, Handler: a.securityHeaders(mux), ReadHeaderTimeout: 3*time.Second, ReadTimeout: 30*time.Second, WriteTimeout: 480*time.Second, IdleTimeout: 60*time.Second}
    if err := s.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) { panic(err) }
}

func localOrigin(o string) bool {
    return o == "http://127.0.0.1:37654" || o == "http://localhost:37654" || o == "https://127.0.0.1:37654" || o == "https://localhost:37654"
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
        if r.Method == http.MethodOptions { w.WriteHeader(http.StatusNoContent); return }
        next.ServeHTTP(w, r)
    })
}

func (a *app) auth(next http.HandlerFunc) http.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        if site := r.Header.Get("Sec-Fetch-Site"); site == "cross-site" { out(w, http.StatusForbidden, map[string]any{"ok":false,"error":"cross_site_blocked"}); return }
        if origin := r.Header.Get("Origin"); origin != "" && !localOrigin(origin) { out(w, http.StatusForbidden, map[string]any{"ok":false,"error":"origin_not_allowed"}); return }
        presented := ""
        if c, err := r.Cookie(cookieName); err == nil { presented = strings.TrimSpace(c.Value) }
        if presented == "" { presented = strings.TrimSpace(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")) }
        if len(presented) != len(a.token) || subtle.ConstantTimeCompare([]byte(presented), []byte(a.token)) != 1 { out(w, http.StatusUnauthorized, map[string]any{"ok":false,"error":"local_session_required"}); return }
        next(w, r)
    }
}

func (a *app) localController(w http.ResponseWriter, r *http.Request) {
    if r.Method != http.MethodGet && r.Method != http.MethodHead { http.Error(w, "method not allowed", http.StatusMethodNotAllowed); return }
    b, err := os.ReadFile(a.controller); if err != nil { http.Error(w, "controller missing", http.StatusServiceUnavailable); return }
    w.Header().Set("Content-Type", "application/javascript; charset=utf-8")
    if r.Method == http.MethodGet { _, _ = w.Write(b) }
}

func (a *app) serverCatalog(w http.ResponseWriter, r *http.Request) {
    out(w, http.StatusOK, []map[string]any{
        {"id":1,"code":"de-fra-01","country_code":"DE","country_name":"Alemanha","city":"Rede Tor","protocol":"tor","status":"online","is_recommended":true,"sort_order":10},
        {"id":2,"code":"us-mia-01","country_code":"US","country_name":"Estados Unidos","city":"Rede Tor","protocol":"tor","status":"online","is_recommended":false,"sort_order":20},
    })
}

func (a *app) ready() bool {
    paths := []string{a.engine, filepath.Join(a.base,"tun2socks.exe"), filepath.Join(a.base,"wintun.dll"), filepath.Join(a.base,"tor-expert","tor","tor.exe")}
    for _, p := range paths { if i, err := os.Stat(p); err != nil || i.IsDir() { return false } }
    return true
}

func (a *app) health(w http.ResponseWriter, r *http.Request) {
    _, ce := os.Stat(a.controller)
    out(w, http.StatusOK, map[string]any{"ok":true,"helper":true,"version":version,"platform":"windows","transport":"http-local-cookie","engine":"highgas-full-tunnel","engineReady":a.ready(),"torReady":a.ready(),"controllerReady":ce==nil,"directURL":"http://127.0.0.1:37654/"})
}

func runEngine(base, script, action, server string, timeout time.Duration) error {
    ctx, cancel := context.WithTimeout(context.Background(), timeout); defer cancel()
    args := []string{"-NoLogo","-NoProfile","-NonInteractive","-ExecutionPolicy","Bypass","-File",script,"-Action",action}
    if server != "" { args = append(args,"-Server",server) }
    c := exec.CommandContext(ctx, "powershell.exe", args...)
    c.Env = append(os.Environ(), "HIGHGAS_BASE="+base)
    b, err := c.CombinedOutput()
    if ctx.Err() == context.DeadlineExceeded { return fmt.Errorf("engine_timeout") }
    if err != nil { return fmt.Errorf("%s", strings.TrimSpace(string(b))) }
    return nil
}

func engineOutput(base, script, action string, timeout time.Duration) string {
    ctx, cancel := context.WithTimeout(context.Background(), timeout); defer cancel()
    c := exec.CommandContext(ctx,"powershell.exe","-NoLogo","-NoProfile","-NonInteractive","-ExecutionPolicy","Bypass","-File",script,"-Action",action)
    c.Env = append(os.Environ(), "HIGHGAS_BASE="+base)
    b, _ := c.CombinedOutput(); return strings.TrimSpace(string(b))
}

func parseStatus(s string) (bool,string,string,string) {
    f := strings.Fields(s)
    if len(f) >= 5 && f[0] == "connected" && f[1] == "tor" { return true, strings.ToUpper(f[2]), f[3], f[4] }
    return false,"","",""
}

func startedISO(epoch string) string {
    v, err := strconv.ParseInt(epoch,10,64); if err != nil || v <= 0 { return "" }
    return time.Unix(v,0).UTC().Format(time.RFC3339)
}

func (a *app) status(w http.ResponseWriter, r *http.Request) {
    a.mu.Lock(); defer a.mu.Unlock()
    resp := map[string]any{"helper":true,"version":version,"platform":"windows","connected":false,"torReady":a.ready(),"torServers":[]string{"de-fra-01","us-mia-01"},"checkedAt":time.Now().UTC().Format(time.RFC3339)}
    if ok,country,server,started := parseStatus(engineOutput(a.base,a.engine,"status",15*time.Second)); ok {
        resp["connected"] = true; resp["mode"]="tor"; resp["country"]=country; resp["activeServer"]=server; resp["connectedAt"]=startedISO(started)
    }
    out(w,http.StatusOK,resp)
}

func decodeServer(r *http.Request) (serverReq,error) {
    var q serverReq
    err := json.NewDecoder(io.LimitReader(r.Body,8192)).Decode(&q)
    q.Server = strings.ToLower(strings.TrimSpace(q.Server))
    if err != nil || !codeRE.MatchString(q.Server) || (q.Server != "de-fra-01" && q.Server != "us-mia-01") { return q, fmt.Errorf("bad server") }
    return q,nil
}

func (a *app) connect(w http.ResponseWriter, r *http.Request) {
    if r.Method != http.MethodPost { out(w,http.StatusMethodNotAllowed,map[string]any{"ok":false}); return }
    q, err := decodeServer(r); if err != nil { out(w,http.StatusBadRequest,map[string]any{"ok":false,"error":"invalid_server"}); return }
    a.mu.Lock(); defer a.mu.Unlock()
    _ = runEngine(a.base,a.engine,"down","",45*time.Second)
    if !a.ready() { out(w,http.StatusServiceUnavailable,map[string]any{"ok":false,"error":"engine_not_ready"}); return }
    if err := runEngine(a.base,a.engine,"up",q.Server,430*time.Second); err != nil { _ = runEngine(a.base,a.engine,"down","",45*time.Second); out(w,http.StatusBadGateway,map[string]any{"ok":false,"error":"connect_failed","detail":err.Error()}); return }
    verify := engineOutput(a.base,a.engine,"verify",45*time.Second)
    if !strings.Contains(verify,"VERIFIED=1") { _ = runEngine(a.base,a.engine,"down","",45*time.Second); out(w,http.StatusBadGateway,map[string]any{"ok":false,"error":"verification_failed","detail":verify}); return }
    out(w,http.StatusOK,map[string]any{"ok":true,"mode":"tor","server":q.Server,"verified":true})
}

func (a *app) disconnect(w http.ResponseWriter, r *http.Request) {
    if r.Method != http.MethodPost { out(w,http.StatusMethodNotAllowed,map[string]any{"ok":false}); return }
    a.mu.Lock(); defer a.mu.Unlock()
    if err := runEngine(a.base,a.engine,"down","",60*time.Second); err != nil { out(w,http.StatusInternalServerError,map[string]any{"ok":false,"error":"disconnect_failed","detail":err.Error()}); return }
    out(w,http.StatusOK,map[string]any{"ok":true})
}

func (a *app) networkInfo(w http.ResponseWriter, r *http.Request) {
    client := &http.Client{Timeout: 18*time.Second}
    req, _ := http.NewRequest(http.MethodGet, siteURL+"/api/network-info?ts="+strconv.FormatInt(time.Now().UnixNano(),10), nil)
    req.Header.Set("Accept","application/json")
    resp, err := client.Do(req)
    if err != nil { out(w,http.StatusBadGateway,map[string]any{"error":"network_check_failed"}); return }
    defer resp.Body.Close(); w.Header().Set("Content-Type","application/json"); w.WriteHeader(resp.StatusCode); _, _ = io.Copy(w, io.LimitReader(resp.Body,64<<10))
}

func out(w http.ResponseWriter, status int, v any) {
    w.Header().Set("Content-Type","application/json; charset=utf-8"); w.WriteHeader(status); _ = json.NewEncoder(w).Encode(v)
}

func randomToken() string {
    b := make([]byte,32); if _, err := rand.Read(b); err != nil { return "" }; return hex.EncodeToString(b)
}
