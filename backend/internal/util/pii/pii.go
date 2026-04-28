// Package pii deterministically masks Indian identifiers (PAN, Aadhaar,
// GSTIN) before they reach logs or persisted audit payloads.
//
// Operational data paths — the decisions table, documents.ocr_payload,
// extracted criteria — are deliberately untouched: the officer UI and
// the audit-trail-of-record still need the originals. Only the log
// stream and audit_log.payload JSON go through this redactor.
//
// Mask format keeps the last 4 chars for traceability:
//
//	PAN:     ABCDE1234F      -> [PAN:******234F]
//	Aadhaar: 1234 5678 9012  -> [AADHAAR:********9012]
//	GSTIN:   22ABCDE1234F1Z5 -> [GSTIN:***********F1Z5]
//
// Aadhaar is gated on the Verhoeff checksum so we don't redact unrelated
// 12-digit numbers (turnover figures, transaction refs, IMEI strings).
package pii

import (
	"encoding/json"
	"io"
	"regexp"
	"strings"
)

var (
	// PAN: 5 uppercase letters + 4 digits + 1 uppercase letter.
	panRe = regexp.MustCompile(`\b[A-Z]{5}[0-9]{4}[A-Z]\b`)

	// GSTIN: 2-digit state + PAN-shaped + entity char + literal Z + checksum.
	gstinRe = regexp.MustCompile(`\b[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b`)

	// Aadhaar candidate: 12 digits, optionally grouped 4-4-4 with a space
	// or hyphen. We use a loose negative-lookaround surrogate via a capture
	// group + manual boundary checks since Go's RE2 lacks lookaround.
	aadhaarRe = regexp.MustCompile(`(\d{4})[\s-]?(\d{4})[\s-]?(\d{4})`)
)

// Verhoeff tables — UIDAI-published Aadhaar checksum.
var verhoeffD = [10][10]int{
	{0, 1, 2, 3, 4, 5, 6, 7, 8, 9},
	{1, 2, 3, 4, 0, 6, 7, 8, 9, 5},
	{2, 3, 4, 0, 1, 7, 8, 9, 5, 6},
	{3, 4, 0, 1, 2, 8, 9, 5, 6, 7},
	{4, 0, 1, 2, 3, 9, 5, 6, 7, 8},
	{5, 9, 8, 7, 6, 0, 4, 3, 2, 1},
	{6, 5, 9, 8, 7, 1, 0, 4, 3, 2},
	{7, 6, 5, 9, 8, 2, 1, 0, 4, 3},
	{8, 7, 6, 5, 9, 3, 2, 1, 0, 4},
	{9, 8, 7, 6, 5, 4, 3, 2, 1, 0},
}

var verhoeffP = [8][10]int{
	{0, 1, 2, 3, 4, 5, 6, 7, 8, 9},
	{1, 5, 7, 6, 2, 8, 3, 0, 9, 4},
	{5, 8, 0, 3, 7, 9, 6, 1, 4, 2},
	{8, 9, 1, 6, 0, 4, 3, 5, 2, 7},
	{9, 4, 5, 3, 1, 2, 6, 8, 7, 0},
	{4, 2, 8, 6, 5, 7, 3, 9, 0, 1},
	{2, 7, 9, 3, 8, 0, 6, 4, 1, 5},
	{7, 0, 4, 6, 9, 1, 3, 2, 5, 8},
}

func verhoeffValid(digits string) bool {
	if len(digits) != 12 {
		return false
	}
	c := 0
	for i := 0; i < 12; i++ {
		ch := digits[11-i]
		if ch < '0' || ch > '9' {
			return false
		}
		c = verhoeffD[c][verhoeffP[i%8][ch-'0']]
	}
	return c == 0
}

func mask(value, tag string) string {
	const keep = 4
	visible := value
	stars := 0
	if len(value) > keep {
		visible = value[len(value)-keep:]
		stars = len(value) - keep
	}
	var b strings.Builder
	b.Grow(len(tag) + 4 + stars + len(visible))
	b.WriteByte('[')
	b.WriteString(tag)
	b.WriteByte(':')
	for i := 0; i < stars; i++ {
		b.WriteByte('*')
	}
	b.WriteString(visible)
	b.WriteByte(']')
	return b.String()
}

func redactGSTIN(s string) string {
	return gstinRe.ReplaceAllStringFunc(s, func(m string) string {
		return mask(m, "GSTIN")
	})
}

func redactPAN(s string) string {
	return panRe.ReplaceAllStringFunc(s, func(m string) string {
		return mask(m, "PAN")
	})
}

func redactAadhaar(s string) string {
	// Walk matches by byte offset so we can enforce digit-boundary checks
	// (Go's RE2 has no lookaround). Build a new buffer rather than mutating.
	matches := aadhaarRe.FindAllStringSubmatchIndex(s, -1)
	if len(matches) == 0 {
		return s
	}
	var b strings.Builder
	b.Grow(len(s))
	cursor := 0
	for _, m := range matches {
		// m[0]:m[1] = full match; pairs after that = capture groups.
		start, end := m[0], m[1]
		// Boundary checks: byte-before must not be a digit; byte-after must not be a digit.
		if start > 0 && isDigit(s[start-1]) {
			continue
		}
		if end < len(s) && isDigit(s[end]) {
			continue
		}
		// Reconstruct compact 12-digit string from the three capture groups.
		g1 := s[m[2]:m[3]]
		g2 := s[m[4]:m[5]]
		g3 := s[m[6]:m[7]]
		compact := g1 + g2 + g3
		if !verhoeffValid(compact) {
			continue
		}
		b.WriteString(s[cursor:start])
		b.WriteString(mask(compact, "AADHAAR"))
		cursor = end
	}
	b.WriteString(s[cursor:])
	return b.String()
}

func isDigit(b byte) bool { return b >= '0' && b <= '9' }

// Redact masks every PAN/GSTIN/Aadhaar instance in s. Order matters:
// GSTIN is processed first because its tail contains a PAN-shaped substring.
func Redact(s string) string {
	if s == "" {
		return s
	}
	s = redactGSTIN(s)
	s = redactPAN(s)
	s = redactAadhaar(s)
	return s
}

// RedactJSON masks PII in every string-valued node of a JSON document.
// Numbers, booleans, and structural delimiters pass through unchanged.
// On any decode error the input is returned with whole-document Redact()
// applied as a fallback — strings remain protected even when shape is wonky.
func RedactJSON(payload []byte) []byte {
	var v any
	if err := json.Unmarshal(payload, &v); err != nil {
		return []byte(Redact(string(payload)))
	}
	walked := walkRedact(v)
	out, err := json.Marshal(walked)
	if err != nil {
		return []byte(Redact(string(payload)))
	}
	return out
}

func walkRedact(v any) any {
	switch t := v.(type) {
	case string:
		return Redact(t)
	case map[string]any:
		out := make(map[string]any, len(t))
		for k, vv := range t {
			out[k] = walkRedact(vv)
		}
		return out
	case []any:
		out := make([]any, len(t))
		for i, vv := range t {
			out[i] = walkRedact(vv)
		}
		return out
	default:
		return v
	}
}

// Writer wraps an io.Writer and redacts PII from every Write call. The
// stdlib log package writes one record per Write, so byte-bounded PII
// patterns (PAN/Aadhaar/GSTIN) are not split across calls in practice.
type Writer struct{ inner io.Writer }

// NewWriter wraps w so that every Write is redacted.
func NewWriter(w io.Writer) *Writer { return &Writer{inner: w} }

func (w *Writer) Write(p []byte) (int, error) {
	redacted := Redact(string(p))
	n, err := w.inner.Write([]byte(redacted))
	// Report the original length to satisfy log.Output's bookkeeping —
	// it doesn't compare returned n to the redacted length.
	if err != nil {
		// On partial write, scale back to original units.
		if n >= len(p) {
			return len(p), err
		}
		return n, err
	}
	return len(p), nil
}

// Compile-time guarantee.
var _ io.Writer = (*Writer)(nil)
