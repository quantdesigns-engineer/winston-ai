package router

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Checks whether Google Drive is reachable for the configured user before
// we spawn the (expensive) tailoring agent. The check refreshes the stored
// OAuth token via Google's token endpoint, then pings drive.about.get. If
// either step fails, we return a human-readable reason so the UI can show a
// red error and bail without burning agent tokens.
//
// Set WINSTON_DRIVE_CREDS_FILE to the filename of the credentials JSON the
// google-workspace MCP wrote (typically "<your-email>.json").

const (
	driveScopePing = "https://www.googleapis.com/drive/v3/about?fields=user/emailAddress"
)

func driveCredsFilename() string {
	if v := os.Getenv("WINSTON_DRIVE_CREDS_FILE"); v != "" {
		return v
	}
	return "drive-creds.json"
}

type driveCreds struct {
	Token        string   `json:"token"`
	RefreshToken string   `json:"refresh_token"`
	TokenURI     string   `json:"token_uri"`
	ClientID     string   `json:"client_id"`
	ClientSecret string   `json:"client_secret"`
	Scopes       []string `json:"scopes"`
	Expiry       string   `json:"expiry,omitempty"`
}

// preflightDrive verifies we can reach Drive as the configured user. Returns
// nil on success; error otherwise.
func preflightDrive(ctx context.Context) error {
	home, err := os.UserHomeDir()
	if err != nil {
		return fmt.Errorf("home dir: %w", err)
	}
	credPath := filepath.Join(home, ".google_workspace_mcp", "credentials", driveCredsFilename())
	raw, err := os.ReadFile(credPath)
	if err != nil {
		return fmt.Errorf("no Google credentials at %s — re-auth the google-workspace MCP", credPath)
	}
	var c driveCreds
	if err := json.Unmarshal(raw, &c); err != nil {
		return fmt.Errorf("credentials JSON is malformed: %w", err)
	}
	if c.RefreshToken == "" || c.ClientID == "" || c.ClientSecret == "" {
		return fmt.Errorf("credentials file missing refresh_token / client_id / client_secret — re-auth needed")
	}
	if !hasDriveScope(c.Scopes) {
		return fmt.Errorf("OAuth token lacks Drive scopes — re-auth with drive.file + drive")
	}

	// Refresh the access token. Drive MCP does this lazily, but we want to
	// know synchronously before spawning a 5+ min agent.
	accessToken, expiresInSeconds, err := refreshAccessToken(ctx, c)
	if err != nil {
		return fmt.Errorf("token refresh failed (likely revoked): %w", err)
	}

	reqCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(reqCtx, "GET", driveScopePing, nil)
	req.Header.Set("Authorization", "Bearer "+accessToken)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("drive.about.get: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("drive.about.get returned %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	// Write the freshly-refreshed token back to the credentials file so the
	// google-workspace MCP subprocess picks up a live access token on startup
	// instead of trying (and sometimes failing) to lazy-refresh. We saw cases
	// where the MCP emitted a fresh OAuth URL even though the refresh token
	// was perfectly valid — bypassing the MCP's refresh logic avoids that.
	c.Token = accessToken
	if expiresInSeconds > 0 {
		// Match fastmcp/google-auth-library format: naive ISO-8601 local-ish
		// timestamp (no tz suffix), seconds precision.
		c.Expiry = time.Now().Add(time.Duration(expiresInSeconds) * time.Second).
			UTC().Format("2006-01-02T15:04:05.000000")
	}
	if raw, err := json.MarshalIndent(c, "", "  "); err == nil {
		// Best-effort write — don't fail preflight if the file is read-only.
		_ = os.WriteFile(credPath, raw, 0o600)
	}
	return nil
}

func hasDriveScope(scopes []string) bool {
	for _, s := range scopes {
		if strings.Contains(s, "auth/drive") {
			return true
		}
	}
	return false
}

// refreshAccessToken returns a fresh access_token plus its expires_in (seconds).
func refreshAccessToken(ctx context.Context, c driveCreds) (string, int, error) {
	form := url.Values{}
	form.Set("client_id", c.ClientID)
	form.Set("client_secret", c.ClientSecret)
	form.Set("refresh_token", c.RefreshToken)
	form.Set("grant_type", "refresh_token")

	uri := c.TokenURI
	if uri == "" {
		uri = "https://oauth2.googleapis.com/token"
	}
	reqCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(reqCtx, "POST", uri, strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", 0, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	if resp.StatusCode != 200 {
		return "", 0, fmt.Errorf("token endpoint %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	var out struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int    `json:"expires_in"`
		Error       string `json:"error"`
		ErrorDesc   string `json:"error_description"`
	}
	if err := json.Unmarshal(body, &out); err != nil {
		return "", 0, fmt.Errorf("malformed token response: %w", err)
	}
	if out.Error != "" {
		return "", 0, fmt.Errorf("%s: %s", out.Error, out.ErrorDesc)
	}
	if out.AccessToken == "" {
		return "", 0, fmt.Errorf("empty access_token in response")
	}
	return out.AccessToken, out.ExpiresIn, nil
}
