package tracker

import (
	"bytes"
	"compress/gzip"
	"errors"
	"github.com/ap-pauloafonso/ratio-spoof/bencode"
	"io"
	"net/http"
	"strings"
	"time"
)

type HttpTracker struct {
	Urls                    []string
	RetryAttempt            int
	LastAnnounceRequest     string
	LastTrackerResponse     string
	EstimatedTimeToAnnounce time.Time
}

type TrackerResponse struct {
	MinInterval int
	Interval    int
	Seeders     int
	Leechers    int
}

func NewHttpTracker(torrentInfo *bencode.TorrentInfo) (*HttpTracker, error) {

	var result []string
	for _, url := range torrentInfo.TrackerInfo.Urls {
		if strings.HasPrefix(url, "http") {
			result = append(result, url)
		}
	}
	if len(result) == 0 {
		return nil, errors.New("no tcp/http tracker url announce found")
	}
	return &HttpTracker{Urls: torrentInfo.TrackerInfo.Urls}, nil
}

func (t *HttpTracker) swapFirst(currentIdx int) {
	aux := t.Urls[0]
	t.Urls[0] = t.Urls[currentIdx]
	t.Urls[currentIdx] = aux
}

func (t *HttpTracker) updateEstimatedTimeToAnnounce(interval int) {
	t.EstimatedTimeToAnnounce = time.Now().Add(time.Duration(interval) * time.Second)
}
func (t *HttpTracker) handleSuccessfulResponse(resp *TrackerResponse) {
	if resp.Interval <= 0 {
		resp.Interval = 1800
	}

	t.updateEstimatedTimeToAnnounce(resp.Interval)
}

func (t *HttpTracker) Announce(query string, headers map[string]string, retry bool) (*TrackerResponse, error) {
	defer func() {
		t.RetryAttempt = 0
	}()
	if retry {
		retryDelay := 30
		for {
			trackerResp, err := t.tryMakeRequest(query, headers)
			if err != nil {
				t.updateEstimatedTimeToAnnounce(retryDelay)
				t.RetryAttempt++
				time.Sleep(time.Duration(retryDelay) * time.Second)
				retryDelay *= 2
				if retryDelay > 900 {
					retryDelay = 900
				}
				continue
			}
			t.handleSuccessfulResponse(trackerResp)
			return trackerResp, nil
		}

	} else {
		resp, err := t.tryMakeRequest(query, headers)
		if err != nil {
			return nil, err
		}
		t.handleSuccessfulResponse(resp)
		return resp, nil
	}
}

func (t *HttpTracker) tryMakeRequest(query string, headers map[string]string) (*TrackerResponse, error) {
	for idx, baseUrl := range t.Urls {
		completeURL := buildFullUrl(baseUrl, query)
		t.LastAnnounceRequest = completeURL
		req, err := http.NewRequest("GET", completeURL, nil)
		if err != nil {
			continue
		}
		for header, value := range headers {
			req.Header.Add(header, value)
		}
		ret, ok := t.doRequest(req, idx)
		if ok {
			return ret, nil
		}
	}
	return nil, errors.New("connection error with the tracker")
}

// doRequest performs a single HTTP request and always closes the response
// body, regardless of the status code or of how parsing turns out. This
// avoids leaking connections/file descriptors over a long-running session.
func (t *HttpTracker) doRequest(req *http.Request, idx int) (*TrackerResponse, bool) {
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, false
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, false
	}

	bytesR, err := io.ReadAll(resp.Body)
	if err != nil || len(bytesR) == 0 {
		return nil, false
	}

	mimeType := http.DetectContentType(bytesR)
	if mimeType == "application/x-gzip" {
		gzipReader, err := gzip.NewReader(bytes.NewReader(bytesR))
		if err != nil {
			return nil, false
		}
		defer gzipReader.Close()
		bytesR, err = io.ReadAll(gzipReader)
		if err != nil {
			return nil, false
		}
	}
	t.LastTrackerResponse = string(bytesR)

	decodedResp, err := bencode.Decode(bytesR)
	if err != nil {
		return nil, false
	}
	ret, err := extractTrackerResponse(decodedResp)
	if err != nil {
		return nil, false
	}

	if idx != 0 {
		t.swapFirst(idx)
	}
	return &ret, true
}

func buildFullUrl(baseurl, query string) string {
	if len(strings.Split(baseurl, "?")) > 1 {
		return baseurl + "&" + strings.TrimLeft(query, "&")
	}
	return baseurl + "?" + strings.TrimLeft(query, "?")
}

func extractTrackerResponse(datatrackerResponse map[string]interface{}) (TrackerResponse, error) {
	var result TrackerResponse
	if v, ok := datatrackerResponse["failure reason"].(string); ok && len(v) > 0 {
		return result, errors.New(v)
	}
	result.MinInterval, _ = datatrackerResponse["min interval"].(int)
	result.Interval, _ = datatrackerResponse["interval"].(int)
	result.Seeders, _ = datatrackerResponse["complete"].(int)
	result.Leechers, _ = datatrackerResponse["incomplete"].(int)
	return result, nil

}
