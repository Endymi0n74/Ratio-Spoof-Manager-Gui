package tracker

import (
	"bytes"
	"github.com/ap-pauloafonso/ratio-spoof/bencode"
	"io"
	"net/http"
	"reflect"
	"testing"
)

// closeTrackingBody wraps an io.Reader and records whether Close was called,
// so tests can assert the HTTP response body is never leaked.
type closeTrackingBody struct {
	io.Reader
	closed bool
}

func (b *closeTrackingBody) Close() error {
	b.closed = true
	return nil
}

// roundTripFunc lets a plain function satisfy http.RoundTripper.
type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}

// withFakeTransport swaps http.DefaultClient's transport for the duration of
// the test and restores the original afterwards.
func withFakeTransport(t *testing.T, statusCode int, body string) *closeTrackingBody {
	t.Helper()
	trackedBody := &closeTrackingBody{Reader: bytes.NewReader([]byte(body))}
	original := http.DefaultClient.Transport
	http.DefaultClient.Transport = roundTripFunc(func(req *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: statusCode,
			Body:       trackedBody,
			Header:     make(http.Header),
		}, nil
	})
	t.Cleanup(func() { http.DefaultClient.Transport = original })
	return trackedBody
}

func TestTryMakeRequestAlwaysClosesResponseBody(t *testing.T) {
	cases := []struct {
		name       string
		statusCode int
		body       string
	}{
		{"non-200 status", http.StatusInternalServerError, ""},
		{"200 with empty body", http.StatusOK, ""},
		{"200 with invalid bencode", http.StatusOK, "not-bencode"},
		{"200 with valid bencode", http.StatusOK, "d8:completei5e10:incompletei3e8:intervali1800ee"},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			trackedBody := withFakeTransport(t, c.statusCode, c.body)
			tr, _ := NewHttpTracker(&bencode.TorrentInfo{TrackerInfo: &bencode.TrackerInfo{Urls: []string{"http://tracker.example"}}})

			_, _ = tr.tryMakeRequest("", map[string]string{})

			if !trackedBody.closed {
				t.Errorf("response body was not closed for case %q", c.name)
			}
		})
	}
}

func TestNewHttpTracker(t *testing.T) {
	_, err := NewHttpTracker(&bencode.TorrentInfo{TrackerInfo: &bencode.TrackerInfo{Urls: []string{"udp://url1", "udp://url2"}}})
	got := err.Error()
	want := "no tcp/http tracker url announce found"

	if got != want {
		t.Errorf("got: %v want %v", got, want)
	}
}

func TestSwapFirst(t *testing.T) {
	tracker, _ := NewHttpTracker(&bencode.TorrentInfo{TrackerInfo: &bencode.TrackerInfo{Urls: []string{"http://url1", "http://url2", "http://url3", "http://url4"}}})
	tracker.swapFirst(3)

	got := tracker.Urls
	want := []string{"http://url4", "http://url2", "http://url3", "http://url1"}

	if !reflect.DeepEqual(got, want) {
		t.Errorf("got: %v want %v", got, want)
	}
}

func TestHandleSuccessfulResponse(t *testing.T) {

	t.Run("Empty interval should be overided with 1800 ", func(t *testing.T) {
		tracker, _ := NewHttpTracker(&bencode.TorrentInfo{TrackerInfo: &bencode.TrackerInfo{Urls: []string{"http://url1", "http://url2", "http://url3", "http://url4"}}})
		r := TrackerResponse{}
		tracker.handleSuccessfulResponse(&r)
		got := r.Interval
		want := 1800
		if !reflect.DeepEqual(got, want) {
			t.Errorf("got: %v want %v", got, want)
		}

	})

	t.Run("Valid interval shouldn't be overwritten", func(t *testing.T) {
		tracker, _ := NewHttpTracker(&bencode.TorrentInfo{TrackerInfo: &bencode.TrackerInfo{Urls: []string{"http://url1", "http://url2", "http://url3", "http://url4"}}})
		r := TrackerResponse{Interval: 900}
		tracker.handleSuccessfulResponse(&r)
		got := r.Interval
		want := 900
		if !reflect.DeepEqual(got, want) {
			t.Errorf("got: %v want %v", got, want)
		}

	})

}
