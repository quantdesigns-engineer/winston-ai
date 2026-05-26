package router

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// --- IP spoofing tests ---
//
// Winston binds to loopback only with no reverse proxy in front. Forwarded
// headers (Cf-Connecting-Ip, X-Forwarded-For) are attacker-controllable and
// must be ignored — RemoteAddr is authoritative.

func TestSecurity_IPSpoofing_ForwardedHeadersIgnored(t *testing.T) {
	req := httptest.NewRequest("GET", "/", nil)
	req.RemoteAddr = "127.0.0.1:5555"
	req.Header.Set("Cf-Connecting-Ip", "1.1.1.1")
	req.Header.Set("X-Forwarded-For", "2.2.2.2, 3.3.3.3")

	ip := extractIP(req)
	if ip != "127.0.0.1" {
		t.Errorf("forwarded headers must be ignored; expected RemoteAddr 127.0.0.1, got %q", ip)
	}
}

// --- Rate limit bypass tests ---

func TestSecurity_RateLimit_CannotBypassWithHeaders(t *testing.T) {
	handler := RateLimitAPI(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	// Attacker tries to dodge the rate limiter by varying forwarded headers
	// while keeping the same RemoteAddr. Since headers are ignored, they
	// should all hit the same bucket and get blocked.
	blocked := false
	for i := 0; i < 20; i++ {
		req := httptest.NewRequest("GET", "/", nil)
		req.RemoteAddr = "203.0.113.4:4444"
		req.Header.Set("Cf-Connecting-Ip", "spoof-"+string(rune('a'+i)))
		req.Header.Set("X-Forwarded-For", "fake-"+string(rune('a'+i)))
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)

		if rec.Code == http.StatusTooManyRequests {
			blocked = true
			break
		}
	}

	if !blocked {
		t.Error("rate limiter should not be bypassable by varying forwarded headers")
	}
}

// --- Security header tests ---

func TestSecurity_ClickjackingProtection(t *testing.T) {
	handler := SecurityHeaders(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest("GET", "/", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	xfo := rec.Header().Get("X-Frame-Options")
	if xfo != "DENY" {
		t.Errorf("X-Frame-Options should be DENY, got %q", xfo)
	}
}

func TestSecurity_ContentTypeSniffing(t *testing.T) {
	handler := SecurityHeaders(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest("GET", "/", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	xcto := rec.Header().Get("X-Content-Type-Options")
	if xcto != "nosniff" {
		t.Errorf("X-Content-Type-Options should be 'nosniff', got %q", xcto)
	}
}

func TestSecurity_CSPPresent(t *testing.T) {
	handler := SecurityHeaders(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest("GET", "/", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	csp := rec.Header().Get("Content-Security-Policy")
	if csp == "" {
		t.Error("Content-Security-Policy header should be set")
	}
}
