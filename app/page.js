"use client";

import { useState, useRef, useEffect } from "react";
import { fal } from "@fal-ai/client";

fal.config({ proxyUrl: "/api/fal/proxy" });

export default function Home() {
  const [movieIdea, setMovieIdea] = useState("");
  const [status, setStatus] = useState("");
  const [statusActive, setStatusActive] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [showPoster, setShowPoster] = useState(false);
  const [posterLoading, setPosterLoading] = useState(false);
  const [posterUrl, setPosterUrl] = useState("");
  const [posterPrompt, setPosterPrompt] = useState("");
  const [showPosterButtons, setShowPosterButtons] = useState(false);

  const [showStoryboard, setShowStoryboard] = useState(false);
  const [scenes, setScenes] = useState([]);
  const [storyboardProgress, setStoryboardProgress] = useState(0);
  const [storyboardDone, setStoryboardDone] = useState(false);

  const [showVideos, setShowVideos] = useState(false);
  const [videoSlots, setVideoSlots] = useState([]);
  const [videoProgress, setVideoProgress] = useState(0);
  const [videosDone, setVideosDone] = useState(false);

  const [showTrailer, setShowTrailer] = useState(false);
  const [trailerUrls, setTrailerUrls] = useState([]);

  function updateStatus(msg, active = true) {
    setStatus(msg);
    setStatusActive(active);
  }

  // ── Phase 1: Submit idea ──────────────────────────
  async function submitIdea() {
    const idea = movieIdea.trim();
    if (!idea) return;

    setIsSubmitting(true);
    updateStatus("Transforming your idea into a movie poster prompt...");
    setShowPoster(true);
    setPosterLoading(true);
    setShowPosterButtons(false);
    setPosterUrl("");

    try {
      const promptResp = await fetch("/api/generate-poster-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ movieIdea: idea }),
      });
      if (!promptResp.ok) throw new Error((await promptResp.json()).error);
      const { prompt } = await promptResp.json();
      setPosterPrompt(prompt);

      updateStatus("Generating movie poster...");

      const result = await fal.subscribe("fal-ai/nano-banana-pro", {
        input: {
          prompt,
          seed: Math.floor(Math.random() * 100000),
          num_images: 1,
          aspect_ratio: "2:3",
          resolution: "1K",
          output_format: "png",
          safety_tolerance: 5,
        },
      });

      if (result.images?.[0]?.url) {
        setPosterUrl(result.images[0].url);
        setPosterLoading(false);
        setShowPosterButtons(true);
        updateStatus("Poster generated! Does it look good?");
      } else {
        throw new Error("No images returned");
      }
    } catch (err) {
      updateStatus(`Error: ${err.message}`);
      setPosterLoading(false);
    }

    setIsSubmitting(false);
  }

  // ── Phase 2: Poster approval ──────────────────────
  async function retryPoster() {
    setShowPosterButtons(false);
    setPosterUrl("");
    setPosterLoading(true);
    updateStatus("Regenerating poster...");

    try {
      const result = await fal.subscribe("fal-ai/nano-banana-pro", {
        input: {
          prompt: posterPrompt,
          seed: Math.floor(Math.random() * 100000),
          num_images: 1,
          aspect_ratio: "2:3",
          resolution: "1K",
          output_format: "png",
          safety_tolerance: 5,
        },
      });

      if (result.images?.[0]?.url) {
        setPosterUrl(result.images[0].url);
        setPosterLoading(false);
        setShowPosterButtons(true);
        updateStatus("New poster generated! How about this one?");
      } else {
        throw new Error("No images returned");
      }
    } catch (err) {
      updateStatus(`Error: ${err.message}`);
      setPosterLoading(false);
      setShowPosterButtons(true);
    }
  }

  async function approvePoster() {
    setShowPosterButtons(false);
    updateStatus("Poster approved! Generating trailer storyboard...");
    generateStoryboard();
  }

  // ── Phase 3: Storyboard ───────────────────────────
  async function generateStoryboard() {
    setShowStoryboard(true);
    setStoryboardDone(false);
    setStoryboardProgress(0);

    const emptyScenes = Array.from({ length: 7 }, () => ({
      url: "",
      label: "Waiting...",
      beat: "",
      scenePrompt: "",
      loading: true,
    }));
    setScenes(emptyScenes);

    try {
      updateStatus("Generating trailer narrative arc via AI...");
      const planResp = await fetch("/api/plan-storyboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ movieIdea, posterPrompt }),
      });
      if (!planResp.ok) throw new Error((await planResp.json()).error);
      const { scenes: scenePlans } = await planResp.json();

      setScenes((prev) =>
        prev.map((s, i) => ({
          ...s,
          label: scenePlans[i]?.label || s.label,
          beat: scenePlans[i]?.beat || s.beat,
          scenePrompt: scenePlans[i]?.scene || "",
        })),
      );

      updateStatus("Narrative arc planned. Generating storyboard images...");

      const fixedSeed = Math.floor(Math.random() * 100000);

      for (let i = 0; i < scenePlans.length; i++) {
        const scene = scenePlans[i];
        updateStatus(`Generating scene ${i + 1}/7: ${scene.label}`);

        try {
          const result = await fal.subscribe("fal-ai/nano-banana-pro/edit", {
            input: {
              prompt: scene.scene,
              image_urls: [posterUrl],
              seed: fixedSeed,
              num_images: 1,
              aspect_ratio: "16:9",
              resolution: "1K",
              output_format: "png",
              safety_tolerance: 5,
              limit_generations: true,
            },
          });

          if (result.images?.[0]?.url) {
            setScenes((prev) =>
              prev.map((s, idx) =>
                idx === i
                  ? { ...s, url: result.images[0].url, loading: false }
                  : s,
              ),
            );
          } else {
            setScenes((prev) =>
              prev.map((s, idx) =>
                idx === i ? { ...s, label: "Failed", loading: false } : s,
              ),
            );
          }
        } catch (err) {
          setScenes((prev) =>
            prev.map((s, idx) =>
              idx === i ? { ...s, label: "Failed", loading: false } : s,
            ),
          );
          updateStatus(`Scene ${i + 1} failed: ${err.message}`);
        }

        setStoryboardProgress(((i + 1) / 7) * 100);
      }

      setStoryboardDone(true);
      updateStatus(
        "Storyboard complete! Review and regenerate any scenes, then generate videos.",
      );
    } catch (err) {
      updateStatus(`Error: ${err.message}`);
    }
  }

  async function regenScene(index) {
    const scene = scenes[index];
    if (!scene?.scenePrompt) return;

    setScenes((prev) =>
      prev.map((s, i) => (i === index ? { ...s, loading: true } : s)),
    );

    try {
      const result = await fal.subscribe("fal-ai/nano-banana-pro/edit", {
        input: {
          prompt: scene.scenePrompt,
          image_urls: [posterUrl],
          seed: Math.floor(Math.random() * 100000),
          num_images: 1,
          aspect_ratio: "16:9",
          resolution: "1K",
          output_format: "png",
          safety_tolerance: 5,
          limit_generations: true,
        },
      });

      if (result.images?.[0]?.url) {
        setScenes((prev) =>
          prev.map((s, i) =>
            i === index
              ? { ...s, url: result.images[0].url, loading: false }
              : s,
          ),
        );
      }
    } catch (err) {
      updateStatus(`Regen failed: ${err.message}`);
      setScenes((prev) =>
        prev.map((s, i) => (i === index ? { ...s, loading: false } : s)),
      );
    }
  }

  // ── Phase 4: Videos ───────────────────────────────
  async function generateVideos() {
    setShowVideos(true);
    setVideosDone(false);
    setVideoProgress(0);
    setStoryboardDone(false);

    const validScenes = scenes.filter((s) => s.url);

    try {
      updateStatus("Generating cinematic motion prompts...");
      const promptsResp = await fetch("/api/plan-video-prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          movieIdea,
          sceneLabels: validScenes.map((s) => s.label),
        }),
      });
      if (!promptsResp.ok) throw new Error((await promptsResp.json()).error);
      const { prompts: videoPrompts } = await promptsResp.json();

      updateStatus("Generating studio intro and closing cards...");

      const [introResult, closingResult] = await Promise.all([
        fal.subscribe("fal-ai/nano-banana-pro", {
          input: {
            prompt:
              'A dramatic movie studio logo intro card. Dark cinematic background with golden light rays. An ornate film studio emblem with "OJ PICTURES" text in elegant gold lettering. Classic Hollywood studio intro style, dramatic volumetric lighting, lens flare, premium cinematic quality.',
            seed: Math.floor(Math.random() * 100000),
            num_images: 1,
            aspect_ratio: "16:9",
            resolution: "1K",
            output_format: "png",
            safety_tolerance: 5,
          },
        }),
        fal.subscribe("fal-ai/nano-banana-pro", {
          input: {
            prompt:
              'A cinematic "COMING SOON" title card for a movie trailer. Bold dramatic typography reading "COMING SOON" centered on a dark moody background. Film grain, dramatic lighting, professional movie marketing design, premium quality.',
            seed: Math.floor(Math.random() * 100000),
            num_images: 1,
            aspect_ratio: "16:9",
            resolution: "1K",
            output_format: "png",
            safety_tolerance: 5,
          },
        }),
      ]);

      const introImageUrl = introResult.images?.[0]?.url;
      const closingImageUrl = closingResult.images?.[0]?.url;

      const allJobs = [];

      if (introImageUrl) {
        allJobs.push({
          type: "bookend-intro",
          index: -1,
          imageUrl: introImageUrl,
          label: "Studio Intro",
          prompt:
            "Dramatic movie studio logo animation. Slow zoom in with golden light rays expanding, lens flare intensifying. Cinematic reveal.",
        });
      }

      validScenes.forEach((scene, i) => {
        allJobs.push({
          type: "content",
          index: i,
          imageUrl: scene.url,
          label: scene.label,
          prompt:
            videoPrompts[i] ||
            "Cinematic scene motion, dramatic camera movement, movie trailer style.",
        });
      });

      if (closingImageUrl) {
        allJobs.push({
          type: "bookend-closing",
          index: -2,
          imageUrl: closingImageUrl,
          label: "Coming Soon",
          prompt:
            "COMING SOON text gently pulsing with dramatic light. Subtle lens flare and film grain. Slow cinematic fade.",
        });
      }

      setVideoSlots(
        allJobs.map((j) => ({
          type: j.type,
          index: j.index,
          label: j.label,
          imageUrl: j.imageUrl,
          videoUrl: "",
          prompt: j.prompt,
          loading: true,
          error: false,
        })),
      );

      updateStatus(`Submitting ${allJobs.length} video generation jobs...`);

      let completedCount = 0;
      const totalJobs = allJobs.length;

      const videoPromises = allJobs.map(async (job, jobIdx) => {
        try {
          const result = await fal.subscribe(
            "fal-ai/kling-video/v3/pro/image-to-video",
            {
              input: {
                prompt: job.prompt,
                image_url: job.imageUrl,
                duration: "5",
                aspect_ratio: "16:9",
                negative_prompt:
                  "blur, distortion, low quality, text overlay, watermark",
                cfg_scale: 0.5,
              },
              pollInterval: 5000,
              onQueueUpdate: (update) => {
                const label =
                  job.type === "content"
                    ? `Scene ${job.index + 1}`
                    : job.label;
                updateStatus(`${label}: ${update.status}...`);
              },
            },
          );

          if (result.video?.url) {
            completedCount++;
            setVideoSlots((prev) =>
              prev.map((s, i) =>
                i === jobIdx
                  ? { ...s, videoUrl: result.video.url, loading: false }
                  : s,
              ),
            );
            setVideoProgress((completedCount / totalJobs) * 100);
            updateStatus(
              `${job.label} complete (${completedCount}/${totalJobs})`,
            );
            return { ...job, videoUrl: result.video.url };
          }
          throw new Error("No video in result");
        } catch (err) {
          completedCount++;
          setVideoSlots((prev) =>
            prev.map((s, i) =>
              i === jobIdx ? { ...s, loading: false, error: true } : s,
            ),
          );
          setVideoProgress((completedCount / totalJobs) * 100);
          return { ...job, error: err.message };
        }
      });

      await Promise.allSettled(videoPromises);

      setVideosDone(true);
      updateStatus("All videos complete! Review and create your trailer.");
    } catch (err) {
      updateStatus(`Error: ${err.message}`);
    }
  }

  async function regenVideo(jobIdx) {
    const slot = videoSlots[jobIdx];
    if (!slot) return;

    setVideoSlots((prev) =>
      prev.map((s, i) =>
        i === jobIdx ? { ...s, loading: true, error: false, videoUrl: "" } : s,
      ),
    );

    try {
      const result = await fal.subscribe(
        "fal-ai/kling-video/v3/pro/image-to-video",
        {
          input: {
            prompt: slot.prompt,
            image_url: slot.imageUrl,
            duration: "5",
            aspect_ratio: "16:9",
            negative_prompt:
              "blur, distortion, low quality, text overlay, watermark",
            cfg_scale: 0.5,
          },
          pollInterval: 5000,
        },
      );

      if (result.video?.url) {
        setVideoSlots((prev) =>
          prev.map((s, i) =>
            i === jobIdx
              ? { ...s, videoUrl: result.video.url, loading: false }
              : s,
          ),
        );
      }
    } catch (err) {
      updateStatus(`Regen failed: ${err.message}`);
      setVideoSlots((prev) =>
        prev.map((s, i) =>
          i === jobIdx ? { ...s, loading: false, error: true } : s,
        ),
      );
    }
  }

  // ── Phase 5: Trailer ──────────────────────────────
  function watchTrailer() {
    const orderedUrls = videoSlots
      .filter((s) => s.videoUrl)
      .sort((a, b) => {
        const order = { "bookend-intro": 0, content: 1, "bookend-closing": 2 };
        const typeCompare = (order[a.type] ?? 1) - (order[b.type] ?? 1);
        if (typeCompare !== 0) return typeCompare;
        return a.index - b.index;
      })
      .map((s) => s.videoUrl);

    if (orderedUrls.length === 0) {
      updateStatus("No videos available!");
      return;
    }

    setTrailerUrls(orderedUrls);
    setShowTrailer(true);
    updateStatus("Your OJ Movie Trailer is ready!");
  }

  function startOver() {
    setMovieIdea("");
    setStatus("");
    setStatusActive(false);
    setIsSubmitting(false);
    setShowPoster(false);
    setPosterLoading(false);
    setPosterUrl("");
    setPosterPrompt("");
    setShowPosterButtons(false);
    setShowStoryboard(false);
    setScenes([]);
    setStoryboardProgress(0);
    setStoryboardDone(false);
    setShowVideos(false);
    setVideoSlots([]);
    setVideoProgress(0);
    setVideosDone(false);
    setShowTrailer(false);
    setTrailerUrls([]);
  }

  return (
    <div className="app">
      <div className="header">
        <img src="/ohjay.png" alt="OJ Movie Maker" className="header-logo" />
        <h1>OJ Movie Maker</h1>
        <p>
          Put OJ Simpson in any movie. Generate a poster, storyboard, and
          trailer.
        </p>
      </div>

      <div className="card">
        <h2>What movie do you want to put OJ in?</h2>
        <div className="idea-input-wrap">
          <input
            type="text"
            className="idea-input"
            value={movieIdea}
            onChange={(e) => setMovieIdea(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitIdea()}
            placeholder="e.g. Make OJ the lead in Home Alone, buddy cop with a tiger..."
          />
          <button
            className="btn btn-gold"
            onClick={submitIdea}
            disabled={isSubmitting}
          >
            Make It
          </button>
        </div>
      </div>

      <div className={`status-bar${statusActive ? " active" : ""}`}>
        {status}
      </div>

      {showPoster && (
        <div className="card">
          <h2>Movie Poster</h2>
          <div className="poster-area">
            {posterLoading && <div className="spinner" />}
            {posterUrl && (
              <img className="poster-img" src={posterUrl} alt="Movie poster" />
            )}
            {showPosterButtons && (
              <div className="poster-buttons">
                <button className="btn btn-gold" onClick={approvePoster}>
                  Looks Good!
                </button>
                <button className="btn btn-ghost" onClick={retryPoster}>
                  Try Again
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {showStoryboard && (
        <div className="card">
          <h2>Trailer Storyboard</h2>
          <div className="progress-track">
            <div
              className="progress-fill"
              style={{ width: `${storyboardProgress}%` }}
            />
          </div>
          <div className="storyboard-grid">
            {scenes.map((scene, i) => (
              <div className="scene-card" key={i}>
                {scene.url ? (
                  <img src={scene.url} alt={scene.label} />
                ) : (
                  <div className="scene-placeholder">
                    {scene.loading ? (
                      <div className="spinner" />
                    ) : (
                      `Scene ${i + 1}`
                    )}
                  </div>
                )}
                <div className="scene-info">
                  <span className="scene-label">{scene.label}</span>
                  {scene.url && !scene.loading && (
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => regenScene(i)}
                    >
                      Redo
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
          {storyboardDone && (
            <div className="center-actions">
              <button className="btn btn-gold" onClick={generateVideos}>
                Generate Trailer Videos
              </button>
            </div>
          )}
        </div>
      )}

      {showVideos && (
        <div className="card">
          <h2>Trailer Videos</h2>
          <div className="progress-track">
            <div
              className="progress-fill"
              style={{ width: `${videoProgress}%` }}
            />
          </div>
          <div className="video-grid">
            {videoSlots.map((slot, i) => (
              <div className="video-card" key={i}>
                {slot.videoUrl ? (
                  <video
                    src={slot.videoUrl}
                    muted
                    loop
                    playsInline
                    onMouseEnter={(e) => e.target.play()}
                    onMouseLeave={(e) => {
                      e.target.pause();
                      e.target.currentTime = 0;
                    }}
                  />
                ) : (
                  <div className="video-placeholder">
                    {slot.loading ? (
                      <div className="spinner" />
                    ) : slot.error ? (
                      "Failed"
                    ) : (
                      slot.label
                    )}
                  </div>
                )}
                <div className="video-info">
                  <span className="video-label">{slot.label}</span>
                  {(slot.videoUrl || slot.error) && !slot.loading && (
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => regenVideo(i)}
                    >
                      Redo
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
          {videosDone && (
            <div className="center-actions">
              <button className="btn btn-gold" onClick={watchTrailer}>
                Watch Trailer
              </button>
            </div>
          )}
        </div>
      )}

      {showTrailer && (
        <div className="card">
          <h2>Your OJ Movie Trailer</h2>
          <TrailerPlayer urls={trailerUrls} />
          <div className="center-actions">
            <button className="btn btn-ghost" onClick={startOver}>
              Start Over
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function TrailerPlayer({ urls }) {
  const videoRef = useRef(null);
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.load();
      videoRef.current.play().catch(() => {});
    }
  }, [currentIndex]);

  function handleEnded() {
    if (currentIndex < urls.length - 1) {
      setCurrentIndex((prev) => prev + 1);
    }
  }

  return (
    <div className="trailer-player">
      <video
        ref={videoRef}
        src={urls[currentIndex]}
        controls
        onEnded={handleEnded}
      />
      <p className="trailer-counter">
        Scene {currentIndex + 1} of {urls.length}
      </p>
    </div>
  );
}
