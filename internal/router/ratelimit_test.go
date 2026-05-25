package router

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestExtractIP_IgnoresForwardedHeaders(t *testing.T) {
	req := httptest.NewRequest("GET", "/", nil)
	req.RemoteAddr = "10.20.30.40:1234"
	req.Header.Set("Cf-Connecting-Ip", "1.2.3.4")
	req.Header.Set("X-Forwarded-For", "5.6.7.8, 9.9.9.9")

	got := extractIP(req)
	if got != "10.20.30.40" {
		t.Errorf("forwarded headers must be ignored; expected RemoteAddr 10.20.30.40, got %q", got)
	}
}

func TestExtractIP_RemoteAddr(t *testing.T) {
	req := httptest.NewRequest("GET", "/", nil)
	// httptest sets RemoteAddr to "192.0.2.1:1234"
	got := extractIP(req)
	if got != "192.0.2.1" {
		t.Errorf("expected RemoteAddr without port, got %q", got)
	}
}

func TestRateLimitAPI_AllowsNormalTraffic(t *testing.T) {
	handler := RateLimitAPI(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest("GET", "/api/agents", nil)
	req.RemoteAddr = "203.0.113.1:1111" // unique per test to avoid bucket contamination
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200 for first request, got %d", rec.Code)
	}
}

func TestRateLimitAPI_BlocksExcessiveTraffic(t *testing.T) {
	handler := RateLimitAPI(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	// Exhaust the burst limit (5 for API limiter)
	for i := 0; i < 20; i++ {
		req := httptest.NewRequest("GET", "/api/agents", nil)
		req.RemoteAddr = "203.0.113.2:2222" // unique per test, reused inside loop
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)

		if rec.Code == http.StatusTooManyRequests {
			return // Test passed — rate limit kicked in
		}
	}

	t.Error("rate limiter did not trigger after 20 requests")
}

func TestRateLimitAuth_BlocksBruteForce(t *testing.T) {
	handler := RateLimitAuth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	// Exhaust the burst limit (10 for auth limiter)
	for i := 0; i < 30; i++ {
		req := httptest.NewRequest("POST", "/api/agents", nil)
		req.RemoteAddr = "203.0.113.3:3333"
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)

		if rec.Code == http.StatusTooManyRequests {
			return // Test passed
		}
	}

	t.Error("auth rate limiter did not trigger after 30 requests")
}

func TestRateLimitAPI_DifferentIPsIndependent(t *testing.T) {
	handler := RateLimitAPI(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	// Make requests from two different IPs (set via RemoteAddr — forwarded
	// headers are not trusted post-tunnel teardown).
	for _, ip := range []string{"10.0.0.1:1234", "10.0.0.2:1234"} {
		req := httptest.NewRequest("GET", "/api/agents", nil)
		req.RemoteAddr = ip
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Errorf("first request from %s should succeed, got %d", ip, rec.Code)
		}
	}
}
