package router

import (
	"crypto/sha256"
	"crypto/subtle"
	"net"
	"net/http"
	"os"
)

// isLoopback reports whether the request originated from the local machine
// (127.0.0.0/8 or ::1), based on the raw connection address only. It uses
// r.RemoteAddr — never X-Forwarded-For — so a forged header cannot spoof
// "local". Note: if Winston is ever fronted by a same-host reverse proxy,
// RemoteAddr is the proxy's loopback IP, so all traffic would read as local;
// keep Winston bound to 127.0.0.1 (no proxy) for this to mean what it says.
func isLoopback(r *http.Request) bool {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

// BasicAuth middleware protects routes with username/password.
// Credentials are read from POLYMR_USER and POLYMR_PASS env vars.
//
// Local development convenience: requests from the loopback interface skip
// auth entirely (the web UI is used locally and the only real integration is
// Slack). Any non-loopback request still goes through the fail-closed
// username/password check below.
func BasicAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if isLoopback(r) {
			next.ServeHTTP(w, r)
			return
		}

		expectedUser := os.Getenv("POLYMR_USER")
		expectedPass := os.Getenv("POLYMR_PASS")

		if expectedUser == "" || expectedPass == "" {
			// No auth configured — block everything
			http.Error(w, "Auth not configured", http.StatusForbidden)
			return
		}

		user, pass, ok := r.BasicAuth()
		if !ok || !secureCompare(user, expectedUser) || !secureCompare(pass, expectedPass) {
			attemptedUser := user
			if attemptedUser == "" {
				attemptedUser = "[no-user]"
			}
			LogFailedAuth(r, attemptedUser)
			w.Header().Set("WWW-Authenticate", `Basic realm="Winston"`)
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}

		next.ServeHTTP(w, r)
	})
}

func secureCompare(a, b string) bool {
	ha := sha256.Sum256([]byte(a))
	hb := sha256.Sum256([]byte(b))
	return subtle.ConstantTimeCompare(ha[:], hb[:]) == 1
}
