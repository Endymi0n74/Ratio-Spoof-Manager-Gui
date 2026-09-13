package ratiospoof

import (
	"fmt"
	"github.com/ap-pauloafonso/ratio-spoof/bencode"
	"github.com/ap-pauloafonso/ratio-spoof/emulation"
	"github.com/ap-pauloafonso/ratio-spoof/input"
	"github.com/ap-pauloafonso/ratio-spoof/tracker"
	"math/rand"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/gammazero/deque"
)

const (
	maxAnnounceHistory = 10
)

type RatioSpoof struct {
	TorrentInfo      *bencode.TorrentInfo
	Input            *input.InputParsed
	Tracker          *tracker.HttpTracker
	BitTorrentClient *emulation.Emulation
	AnnounceInterval int
	NumWant          int
	Seeders          int
	Leechers         int
	AnnounceCount    int
	Status           string
	AnnounceHistory  announceHistory
	Print            bool
}

type AnnounceEntry struct {
	Count             int
	Downloaded        int
	PercentDownloaded float32
	Uploaded          int
	Left              int
}

type announceHistory struct {
	deque.Deque
}

func NewRatioSpoofState(inputArgs input.InputArgs) (*RatioSpoof, error) {
	dat, err := os.ReadFile(inputArgs.TorrentPath)
	if err != nil {
		return nil, err
	}

	client, err := emulation.NewEmulation(inputArgs.Client)
	if err != nil {
		return nil, fmt.Errorf("error building the emulated client with the code %q: %w", inputArgs.Client, err)
	}

	torrentInfo, err := bencode.TorrentDictParse(dat)
	if err != nil {
		return nil, fmt.Errorf("failed to parse the torrent file: %w", err)
	}

	httpTracker, err := tracker.NewHttpTracker(torrentInfo)
	if err != nil {
		return nil, err
	}

	inputParsed, err := inputArgs.ParseInput(torrentInfo)
	if err != nil {
		return nil, err
	}

	return &RatioSpoof{
		BitTorrentClient: client,
		TorrentInfo:      torrentInfo,
		Tracker:          httpTracker,
		Input:            inputParsed,
		NumWant:          200,
		Status:           "started",
		Print:            true,
	}, nil
}

func (a *announceHistory) pushValueHistory(value AnnounceEntry) {
	if a.Len() >= maxAnnounceHistory {
		a.PopFront()
	}
	a.PushBack(value)
}

// gracefullyExit sends the final "stopped" announce to the tracker so it
// stops counting this peer. It returns any error from that final announce
// instead of killing the process, so the caller decides how to report it.
func (r *RatioSpoof) gracefullyExit() error {
	fmt.Printf("\nGracefully exiting...\n")
	r.Status = "stopped"
	r.NumWant = 0
	if err := r.fireAnnounce(false); err != nil {
		return fmt.Errorf("failed to notify the tracker about the shutdown: %w", err)
	}
	fmt.Printf("Gracefully exited successfully.\n")
	return nil
}

// Run starts the announce loop and blocks until the process receives an
// interrupt/termination signal, at which point it attempts one last
// "stopped" announce before returning. It returns any error encountered
// along the way instead of terminating the process itself.
func (r *RatioSpoof) Run() error {
	sigCh := make(chan os.Signal, 1)

	signal.Notify(sigCh, os.Interrupt, syscall.SIGINT, syscall.SIGTERM)
	if err := r.firstAnnounce(); err != nil {
		return err
	}
	go func() {
		for {
			r.generateNextAnnounce()
			time.Sleep(time.Duration(r.AnnounceInterval) * time.Second)
			// retry=true: tracker.Announce retries internally with
			// backoff until it succeeds, so an error here would only
			// surface if that contract ever changes.
			if err := r.fireAnnounce(true); err != nil {
				fmt.Printf("\nannounce failed: %s\n", err.Error())
			}
		}
	}()
	<-sigCh
	r.Print = false
	return r.gracefullyExit()
}
func (r *RatioSpoof) firstAnnounce() error {
	r.addAnnounce(r.Input.InitialDownloaded, r.Input.InitialUploaded, calculateBytesLeft(r.Input.InitialDownloaded, r.TorrentInfo.TotalSize), (float32(r.Input.InitialDownloaded)/float32(r.TorrentInfo.TotalSize))*100)
	return r.fireAnnounce(false)
}

func (r *RatioSpoof) updateSeedersAndLeechers(resp tracker.TrackerResponse) {
	r.Seeders = resp.Seeders
	r.Leechers = resp.Leechers
}
func (r *RatioSpoof) addAnnounce(currentDownloaded, currentUploaded, currentLeft int, percentDownloaded float32) {
	r.AnnounceCount++
	r.AnnounceHistory.pushValueHistory(AnnounceEntry{Count: r.AnnounceCount, Downloaded: currentDownloaded, Uploaded: currentUploaded, Left: currentLeft, PercentDownloaded: percentDownloaded})
}
func (r *RatioSpoof) fireAnnounce(retry bool) error {
	lastAnnounce := r.AnnounceHistory.Back().(AnnounceEntry)
	replacer := strings.NewReplacer("{infohash}", r.TorrentInfo.InfoHashURLEncoded,
		"{port}", fmt.Sprint(r.Input.Port),
		"{peerid}", r.BitTorrentClient.PeerId(),
		"{uploaded}", fmt.Sprint(lastAnnounce.Uploaded),
		"{downloaded}", fmt.Sprint(lastAnnounce.Downloaded),
		"{left}", fmt.Sprint(lastAnnounce.Left),
		"{key}", r.BitTorrentClient.Key(),
		"{event}", r.Status,
		"{numwant}", fmt.Sprint(r.NumWant))
	query := replacer.Replace(r.BitTorrentClient.Query)
	trackerResp, err := r.Tracker.Announce(query, r.BitTorrentClient.Headers, retry)
	if err != nil {
		return fmt.Errorf("failed to reach the tracker: %w", err)
	}

	if trackerResp != nil {
		r.updateSeedersAndLeechers(*trackerResp)
		r.AnnounceInterval = trackerResp.Interval
	}
	return nil
}
func (r *RatioSpoof) generateNextAnnounce() {
	lastAnnounce := r.AnnounceHistory.Back().(AnnounceEntry)
	currentDownloaded := lastAnnounce.Downloaded
	var downloadCandidate int

	if currentDownloaded < r.TorrentInfo.TotalSize {
		randomPiecesDownload := rand.Intn(10-1) + 1
		downloadCandidate = calculateNextTotalSizeByte(r.Input.DownloadSpeed, currentDownloaded, r.TorrentInfo.PieceSize, r.AnnounceInterval, r.TorrentInfo.TotalSize, randomPiecesDownload)
	} else {
		downloadCandidate = r.TorrentInfo.TotalSize
	}

	currentUploaded := lastAnnounce.Uploaded
	randomPiecesUpload := rand.Intn(10-1) + 1
	uploadCandidate := calculateNextTotalSizeByte(r.Input.UploadSpeed, currentUploaded, r.TorrentInfo.PieceSize, r.AnnounceInterval, 0, randomPiecesUpload)

	leftCandidate := calculateBytesLeft(downloadCandidate, r.TorrentInfo.TotalSize)

	d, u, l := r.BitTorrentClient.Round(downloadCandidate, uploadCandidate, leftCandidate, r.TorrentInfo.PieceSize)

	r.addAnnounce(d, u, l, (float32(d)/float32(r.TorrentInfo.TotalSize))*100)
}

func calculateNextTotalSizeByte(speedBytePerSecond, currentByte, pieceSizeByte, seconds, limitTotalBytes, randomPieces int) int {
	if speedBytePerSecond == 0 {
		return currentByte
	}
	totalCandidate := currentByte + (speedBytePerSecond * seconds)
	totalCandidate = totalCandidate + (pieceSizeByte * randomPieces)

	if limitTotalBytes != 0 && totalCandidate > limitTotalBytes {
		return limitTotalBytes
	}
	return totalCandidate
}

func calculateBytesLeft(currentBytes, totalBytes int) int {
	return totalBytes - currentBytes
}
