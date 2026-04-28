package pii

import (
	"bytes"
	"encoding/json"
	"log"
	"strings"
	"testing"
)

// UIDAI publishes 999999990019 as a Verhoeff-valid Aadhaar test number.
const (
	validAadhaar   = "999999990019"
	invalidAadhaar = "123456789012" // checksum invalid — must NOT be redacted
	validPAN       = "ABCDE1234F"
	validGSTIN     = "22ABCDE1234F1Z5"
)

func TestRedactPAN(t *testing.T) {
	out := Redact("PAN on file: " + validPAN + ".")
	if strings.Contains(out, validPAN) {
		t.Fatalf("raw PAN survived: %q", out)
	}
	if !strings.Contains(out, "[PAN:******234F]") {
		t.Fatalf("unexpected PAN mask: %q", out)
	}
}

func TestPANWordBoundary(t *testing.T) {
	in := "XABCDE1234FY"
	if got := Redact(in); got != in {
		t.Fatalf("embedded PAN-shape must not match: got %q", got)
	}
}

func TestPANLowercaseIgnored(t *testing.T) {
	in := "abcde1234f"
	if got := Redact(in); got != in {
		t.Fatalf("lowercase must not match: got %q", got)
	}
}

func TestRedactAadhaarGrouped(t *testing.T) {
	out := Redact("Aadhaar 9999 9999 0019 verified.")
	if strings.Contains(out, "9999 9999 0019") {
		t.Fatalf("raw Aadhaar survived: %q", out)
	}
	if !strings.Contains(out, "[AADHAAR:********0019]") {
		t.Fatalf("unexpected Aadhaar mask: %q", out)
	}
}

func TestRedactAadhaarHyphenated(t *testing.T) {
	out := Redact("id=9999-9999-0019")
	if !strings.Contains(out, "[AADHAAR:********0019]") {
		t.Fatalf("hyphenated form not masked: %q", out)
	}
}

func TestRedactAadhaarCompact(t *testing.T) {
	out := Redact("raw=" + validAadhaar)
	if !strings.Contains(out, "[AADHAAR:") {
		t.Fatalf("compact form not masked: %q", out)
	}
}

func TestAadhaarInvalidChecksumIgnored(t *testing.T) {
	in := "txn=" + invalidAadhaar
	if got := Redact(in); got != in {
		t.Fatalf("invalid-checksum 12-digit must pass through: got %q", got)
	}
}

func TestAadhaarLongNumberNotSliced(t *testing.T) {
	in := "amount=1234567890123" // 13 digits
	if got := Redact(in); got != in {
		t.Fatalf("13-digit number must not yield a 12-digit slice match: got %q", got)
	}
}

func TestAadhaarTurnoverPassthrough(t *testing.T) {
	in := "Turnover INR 5,23,00,00,000 for FY24"
	if got := Redact(in); got != in {
		t.Fatalf("turnover string must not be touched: got %q", got)
	}
}

func TestRedactGSTIN(t *testing.T) {
	out := Redact("GSTIN: " + validGSTIN + ".")
	if strings.Contains(out, validGSTIN) {
		t.Fatalf("raw GSTIN survived: %q", out)
	}
	if !strings.Contains(out, "[GSTIN:***********F1Z5]") {
		t.Fatalf("unexpected GSTIN mask: %q", out)
	}
}

func TestGSTINTakesPrecedenceOverPAN(t *testing.T) {
	// GSTIN chars 3-12 form a valid PAN. The whole GSTIN must mask as one
	// token; we must not see a `[PAN:` anywhere.
	out := Redact("see " + validGSTIN)
	if strings.Contains(out, "[PAN:") {
		t.Fatalf("GSTIN was partially redacted as a PAN: %q", out)
	}
	if !strings.Contains(out, "[GSTIN:") {
		t.Fatalf("GSTIN missed: %q", out)
	}
}

func TestRedactJSONPreservesStructure(t *testing.T) {
	in := []byte(`{"justification":"see PAN ABCDE1234F","amount":100,"ok":true}`)
	out := RedactJSON(in)

	var got map[string]any
	if err := json.Unmarshal(out, &got); err != nil {
		t.Fatalf("redacted JSON unparseable: %v\n%s", err, out)
	}
	if !strings.Contains(got["justification"].(string), "[PAN:") {
		t.Fatalf("justification not redacted: %v", got["justification"])
	}
	// Numbers and bools must survive untouched.
	if got["ok"] != true {
		t.Fatalf("ok flag mangled: %v", got["ok"])
	}
	if got["amount"].(float64) != 100 {
		t.Fatalf("numeric field mangled: %v", got["amount"])
	}
}

func TestRedactJSONNested(t *testing.T) {
	in := []byte(`{"notes":["GSTIN 22ABCDE1234F1Z5","fine"],"meta":{"pan":"ABCDE1234F"}}`)
	out := RedactJSON(in)
	s := string(out)
	if strings.Contains(s, validGSTIN) {
		t.Fatalf("nested GSTIN survived: %s", s)
	}
	if strings.Contains(s, validPAN) {
		t.Fatalf("nested PAN survived: %s", s)
	}
}

func TestRedactJSONMalformedFallback(t *testing.T) {
	// Not valid JSON — function must still mask anything it sees.
	in := []byte("not json but contains PAN ABCDE1234F here")
	out := RedactJSON(in)
	if strings.Contains(string(out), validPAN) {
		t.Fatalf("PAN survived in malformed-JSON fallback: %s", out)
	}
}

func TestWriterRedactsThroughLog(t *testing.T) {
	var buf bytes.Buffer
	w := NewWriter(&buf)
	logger := log.New(w, "", 0)
	logger.Printf("override by user, pan=%s", validPAN)

	out := buf.String()
	if strings.Contains(out, validPAN) {
		t.Fatalf("Writer did not redact: %q", out)
	}
	if !strings.Contains(out, "[PAN:") {
		t.Fatalf("expected mask in output: %q", out)
	}
}

func TestWriterReturnsOriginalLength(t *testing.T) {
	// Stdlib log inspects (n, err); returning the redacted-string length
	// would surprise it. Confirm we report the bytes we accepted.
	var buf bytes.Buffer
	w := NewWriter(&buf)
	src := []byte("PAN ABCDE1234F")
	n, err := w.Write(src)
	if err != nil {
		t.Fatalf("write err: %v", err)
	}
	if n != len(src) {
		t.Fatalf("expected n=%d, got %d", len(src), n)
	}
}

func TestEmptyInput(t *testing.T) {
	if got := Redact(""); got != "" {
		t.Fatalf("empty in must yield empty out, got %q", got)
	}
}
