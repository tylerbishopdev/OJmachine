const express = require("express");
const path = require("path");
const fs = require("fs");
const { execSync } = require("child_process");
const { v4: uuidv4 } = require("uuid");

const app = express();
const PORT = 3847;

const FAL_KEY = "9f745562-fbd8-4155-b59a-6a7de03c8638:ae2b152d4150ee82c31795bf849a46fb";
const FAL_GENERATE_URL = "https://fal.run/fal-ai/nano-banana-pro";
const FAL_EDIT_URL = "https://fal.run/fal-ai/nano-banana-pro/edit";
const KLING_QUEUE_URL = "https://queue.fal.run/fal-ai/kling-video/v3/pro/image-to-video";
const OPENROUTER_URL = "https://fal.run/openrouter/router";
const CLAUDE_MODEL = "anthropic/claude-sonnet-4-6";

// Storage
const postersDir = path.join(__dirname, "posters");
const framesDir = path.join(__dirname, "frames");
const videosDir = path.join(__dirname, "videos");
fs.mkdirSync(postersDir, { recursive: true });
fs.mkdirSync(framesDir, { recursive: true });
fs.mkdirSync(videosDir, { recursive: true });

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.use("/posters", express.static(postersDir));
app.use("/frames", express.static(framesDir));
app.use("/videos", express.static(videosDir));

// ═══════════════════════════════════════════════════════
// Claude API helper
// ═══════════════════════════════════════════════════════
async function askClaude(systemPrompt, userPrompt, temperature = 0.7, maxTokens = 2000) {
  const resp = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Key ${FAL_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      prompt: userPrompt,
      system_prompt: systemPrompt,
      temperature,
      max_tokens: maxTokens,
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Claude error ${resp.status}: ${errText}`);
  }

  const data = await resp.json();
  return (data.output || data.result || "").trim();
}

// Parse JSON from Claude response (handles markdown fences)
function parseClaudeJSON(text) {
  const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  return JSON.parse(cleaned);
}

// ═══════════════════════════════════════════════════════
// Image generation helpers
// ═══════════════════════════════════════════════════════

// Text-to-image via nano-banana-pro
async function generateImage(prompt, seed, aspectRatio = "2:3") {
  const body = {
    prompt,
    seed,
    num_images: 1,
    aspect_ratio: aspectRatio,
    resolution: "1K",
    output_format: "png",
    safety_tolerance: 5,
  };

  const resp = await fetch(FAL_GENERATE_URL, {
    method: "POST",
    headers: {
      Authorization: `Key ${FAL_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`fal.ai generate error ${resp.status}: ${errText}`);
  }

  return resp.json();
}

// Image-guided generation via nano-banana-pro/edit
async function generateFromReference(imageUrls, prompt, seed, aspectRatio = "16:9") {
  const body = {
    prompt,
    image_urls: imageUrls,
    seed,
    num_images: 1,
    aspect_ratio: aspectRatio,
    resolution: "1K",
    output_format: "png",
    safety_tolerance: 5,
    limit_generations: true,
  };

  const resp = await fetch(FAL_EDIT_URL, {
    method: "POST",
    headers: {
      Authorization: `Key ${FAL_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`fal.ai edit error ${resp.status}: ${errText}`);
  }

  return resp.json();
}

// Download an image from URL and save locally
async function downloadImage(url, filename, dir = framesDir) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to download: ${resp.status}`);
  const buffer = Buffer.from(await resp.arrayBuffer());
  const outPath = path.join(dir, filename);
  fs.writeFileSync(outPath, buffer);
  return outPath;
}

// Download video from URL and save locally
async function downloadVideo(url, filename) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to download video: ${resp.status}`);
  const buffer = Buffer.from(await resp.arrayBuffer());
  const outPath = path.join(videosDir, filename);
  fs.writeFileSync(outPath, buffer);
  return `/videos/${filename}`;
}

// Convert local file to data URI
function fileToDataUri(localPath) {
  const buf = fs.readFileSync(localPath);
  const ext = path.extname(localPath).slice(1) || "png";
  const mime = `image/${ext === "jpg" ? "jpeg" : ext}`;
  return `data:${mime};base64,${buf.toString("base64")}`;
}

// ═══════════════════════════════════════════════════════
// Phase 1: Poster Generation
// ═══════════════════════════════════════════════════════

// Transform user's movie idea into a proper poster prompt
app.post("/api/generate-poster-prompt", async (req, res) => {
  const { movieIdea } = req.body;
  if (!movieIdea) return res.status(400).json({ error: "movieIdea required" });

  try {
    const systemPrompt = `You are a movie poster prompt engineer. The user will describe a movie idea featuring OJ Simpson. Your job is to transform their casual description into a detailed, vivid image generation prompt for a movie poster.

RULES:
- The prompt must describe a MOVIE POSTER (not a scene)
- OJ Simpson must be the star/featured prominently
- Include visual details: lighting, composition, typography style, color palette
- Include the movie title on the poster if one is implied
- Keep it under 100 words
- Output ONLY the prompt text, nothing else
- Make it cinematic and professional
- Include "movie poster" and "OJ Simpson" in every prompt

EXAMPLES:
- Input: "make a buddy cop with OJ and a tiger" → "A cinematic movie poster featuring OJ Simpson as a tough cop in sunglasses standing back-to-back with a majestic Bengal tiger wearing a police badge. Bold action movie typography at the top. Dramatic orange and blue lighting, city skyline backdrop. Tagline at bottom. Professional Hollywood movie poster composition."
- Input: "Make OJ the lead in Home Alone" → "A Home Alone movie poster reimagined with OJ Simpson as the lead character, making a shocked face with hands on cheeks. Warm Christmas lighting, snowy house in background. Classic comedy movie poster layout with bold red and green title text. Playful, family movie aesthetic."`;

    const text = await askClaude(systemPrompt, `Movie idea: "${movieIdea}"`, 0.7, 500);
    res.json({ prompt: text });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Generate the movie poster image
app.post("/api/generate-poster", async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: "prompt required" });

  try {
    const seed = Math.floor(Math.random() * 100000);
    const result = await generateImage(prompt, seed, "2:3");

    if (result.images && result.images.length > 0) {
      const sessionId = uuidv4().slice(0, 8);
      const posterName = `${sessionId}_poster.png`;
      const localPath = await downloadImage(result.images[0].url, posterName, postersDir);

      res.json({
        url: `/posters/${posterName}`,
        sessionId,
        seed,
        prompt,
      });
    } else {
      res.status(500).json({ error: "No images returned from generation" });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════
// Phase 2: Storyboard Generation (SSE)
// ═══════════════════════════════════════════════════════

// Generate trailer narrative arc scene descriptions via Claude
async function generateTrailerScenes(movieIdea, posterPrompt) {
  const systemPrompt = `You are a movie trailer editor. Given a movie concept, create exactly 7 scene descriptions for a movie trailer storyboard. Each scene should be a single vivid image that tells part of the story.

TRAILER NARRATIVE ARC (follow this structure):
1. WORLD SETUP - Establishing shot that sets the tone and location
2. CHARACTER INTRO - OJ Simpson's dramatic character reveal/entrance
3. INCITING INCIDENT - The conflict or challenge begins
4. RISING ACTION - Stakes increase, tension builds
5. CLIMAX TEASE - The peak dramatic/action moment
6. EMOTIONAL BEAT - A character moment, reflection, or relationship beat
7. FINAL HOOK - Cliffhanger, title card moment, or iconic final image

RULES:
- Every scene MUST feature OJ Simpson as the main character
- Describe each scene as a single cinematic still/frame
- Include camera angle, lighting, composition
- Maintain visual consistency (same art style, color palette)
- Keep each description under 60 words
- Focus on visual details, not dialogue

Return a JSON array of 7 objects, each with:
- "scene": the image generation prompt
- "label": 2-4 word label (e.g. "City Skyline", "OJ's Entrance")
- "beat": which narrative beat this is (e.g. "World Setup", "Climax Tease")

Return ONLY valid JSON, no markdown fences.`;

  const text = await askClaude(
    systemPrompt,
    `Movie concept: "${movieIdea}"\nPoster style reference: "${posterPrompt}"`,
    0.7,
    2000
  );

  try {
    const scenes = parseClaudeJSON(text);
    if (Array.isArray(scenes) && scenes.length === 7) return scenes;
    throw new Error("Expected 7 scenes");
  } catch (err) {
    console.error("Claude scene generation failed:", err.message);
    // Fallback scenes
    return [
      { scene: `Cinematic establishing shot of the movie world, OJ Simpson movie, dramatic lighting`, label: "World Setup", beat: "World Setup" },
      { scene: `OJ Simpson dramatic character reveal, heroic pose, cinematic lighting`, label: "OJ's Entrance", beat: "Character Intro" },
      { scene: `OJ Simpson facing a challenge, conflict begins, tense atmosphere`, label: "Conflict Begins", beat: "Inciting Incident" },
      { scene: `OJ Simpson in intense action sequence, stakes rising, dramatic angles`, label: "Stakes Rise", beat: "Rising Action" },
      { scene: `OJ Simpson at the peak dramatic moment, climax scene, explosive energy`, label: "Climax", beat: "Climax Tease" },
      { scene: `OJ Simpson emotional character moment, close-up, contemplative lighting`, label: "Reflection", beat: "Emotional Beat" },
      { scene: `OJ Simpson iconic final pose, dramatic silhouette, title card moment`, label: "Final Shot", beat: "Final Hook" },
    ];
  }
}

// SSE endpoint: generate storyboard images
app.post("/api/generate-storyboard", async (req, res) => {
  const { movieIdea, posterPrompt, posterUrl, sessionId } = req.body;

  if (!movieIdea || !posterPrompt || !posterUrl || !sessionId) {
    return res.status(400).json({ error: "movieIdea, posterPrompt, posterUrl, and sessionId required" });
  }

  // Set up SSE
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    // Load poster as reference
    const posterPath = path.join(__dirname, posterUrl);
    if (!fs.existsSync(posterPath)) {
      send({ type: "error", status: "Poster file not found" });
      res.end();
      return;
    }
    const posterDataUri = fileToDataUri(posterPath);
    const fixedSeed = Math.floor(Math.random() * 100000);

    send({ type: "progress", status: "Generating trailer narrative arc via AI...", phase: "planning" });

    // Step 1: Get scene descriptions from Claude
    const scenes = await generateTrailerScenes(movieIdea, posterPrompt);

    send({
      type: "scenes-planned",
      scenes: scenes.map((s) => ({ label: s.label, beat: s.beat })),
      status: "Narrative arc planned. Generating storyboard images...",
    });

    // Step 2: Generate each scene image using poster as reference
    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];

      send({
        type: "progress",
        index: i,
        total: 7,
        status: `Generating scene ${i + 1}/7: ${scene.label}`,
        phase: "generating",
      });

      try {
        const result = await generateFromReference(
          [posterDataUri],
          scene.scene,
          fixedSeed,
          "16:9"
        );

        if (result.images && result.images.length > 0) {
          const frameName = `${sessionId}_scene_${String(i).padStart(2, "0")}.png`;
          await downloadImage(result.images[0].url, frameName);

          send({
            type: "frame",
            index: i,
            total: 7,
            url: `/frames/${frameName}`,
            label: scene.label,
            beat: scene.beat,
            scenePrompt: scene.scene,
            status: `Scene ${i + 1} complete: ${scene.label}`,
          });
        } else {
          send({ type: "error", index: i, status: `Scene ${i + 1} returned no images` });
        }
      } catch (err) {
        send({ type: "error", index: i, status: `Scene ${i + 1} failed: ${err.message}` });
      }
    }

    send({
      type: "complete",
      total: 7,
      sessionId,
      seed: fixedSeed,
      scenes,
    });
  } catch (err) {
    send({ type: "error", status: `Fatal error: ${err.message}` });
  }

  res.end();
});

// Regenerate a single storyboard scene
app.post("/api/regenerate-scene", async (req, res) => {
  const { posterUrl, scenePrompt, index, sessionId } = req.body;

  if (!posterUrl || !scenePrompt) {
    return res.status(400).json({ error: "posterUrl and scenePrompt required" });
  }

  try {
    const posterPath = path.join(__dirname, posterUrl);
    if (!fs.existsSync(posterPath)) {
      return res.status(404).json({ error: "Poster not found" });
    }

    const posterDataUri = fileToDataUri(posterPath);
    const newSeed = Math.floor(Math.random() * 100000);

    const result = await generateFromReference([posterDataUri], scenePrompt, newSeed, "16:9");

    if (result.images && result.images.length > 0) {
      const sid = sessionId || uuidv4().slice(0, 8);
      const frameName = `${sid}_scene_${String(index).padStart(2, "0")}_r${Date.now()}.png`;
      await downloadImage(result.images[0].url, frameName);
      return res.json({ url: `/frames/${frameName}`, index, seed: newSeed });
    }

    res.status(500).json({ error: "No images returned" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════
// Phase 3: Video Generation (Kling v3)
// ═══════════════════════════════════════════════════════

// Submit a video generation job to Kling queue
async function submitKlingJob(imageUrl, prompt, duration = "5", aspectRatio = "16:9") {
  const body = {
    prompt,
    image_url: imageUrl,
    duration,
    aspect_ratio: aspectRatio,
    negative_prompt: "blur, distortion, low quality, text overlay, watermark",
    cfg_scale: 0.5,
  };

  const resp = await fetch(KLING_QUEUE_URL, {
    method: "POST",
    headers: {
      Authorization: `Key ${FAL_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Kling submit error ${resp.status}: ${errText}`);
  }

  return resp.json();
}

// Poll a Kling queue job until completion
async function pollKlingJob(requestId, onProgress, maxAttempts = 120, intervalMs = 5000) {
  const statusUrl = `${KLING_QUEUE_URL}/requests/${requestId}/status`;
  const resultUrl = `${KLING_QUEUE_URL}/requests/${requestId}`;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise((r) => setTimeout(r, intervalMs));

    try {
      const statusResp = await fetch(statusUrl, {
        headers: { Authorization: `Key ${FAL_KEY}` },
      });

      if (!statusResp.ok) continue;

      const statusData = await statusResp.json();
      const status = statusData.status;

      if (onProgress) onProgress(status, attempt);

      if (status === "COMPLETED") {
        const resultResp = await fetch(resultUrl, {
          headers: { Authorization: `Key ${FAL_KEY}` },
        });
        if (!resultResp.ok) throw new Error(`Result fetch failed: ${resultResp.status}`);
        return resultResp.json();
      }

      if (status === "FAILED" || status === "CANCELLED") {
        throw new Error(`Kling job ${requestId} ${status}: ${statusData.error || "unknown error"}`);
      }
    } catch (err) {
      if (attempt === maxAttempts - 1) throw err;
    }
  }

  throw new Error(`Kling job ${requestId} timed out after ${(maxAttempts * intervalMs) / 1000}s`);
}

// Generate video prompts for each scene via Claude
async function generateVideoPrompts(movieIdea, sceneLabels) {
  const systemPrompt = `You are a cinematic video director creating motion prompts for a movie trailer. For each scene, write a brief motion/action description that will bring the still image to life as a 5-second video clip.

RULES:
- Describe specific camera movements (slow zoom, pan, dolly, crane shot)
- Describe subtle character motion (breathing, turning, walking)
- Specify atmosphere (wind, rain, light shifts)
- Keep each prompt under 40 words
- Focus on MOTION and CHANGE, not static description
- Make it feel like a real movie trailer

Return ONLY a JSON array of strings, one prompt per scene. No markdown.`;

  const text = await askClaude(
    systemPrompt,
    `Movie: "${movieIdea}"\nScenes: ${JSON.stringify(sceneLabels)}`,
    0.7,
    1500
  );

  try {
    const prompts = parseClaudeJSON(text);
    if (Array.isArray(prompts) && prompts.length > 0) {
      while (prompts.length < sceneLabels.length) prompts.push(prompts[prompts.length - 1]);
      return prompts.slice(0, sceneLabels.length);
    }
  } catch (err) {
    console.error("Video prompt parse failed:", err.message);
  }

  // Fallback
  return sceneLabels.map((label, i) => {
    return `Cinematic motion: slow dramatic camera movement, subtle character motion, atmospheric effects. Movie trailer scene ${i + 1}: ${label}. Professional cinematography.`;
  });
}

// Generate bookend images (studio intro + coming soon)
async function generateBookendImages(sessionId, movieIdea) {
  const introPrompt = `A dramatic movie studio logo intro card. Dark cinematic background with golden light rays. An ornate film studio emblem with "OJ PICTURES" text in elegant gold lettering. Classic Hollywood studio intro style, dramatic volumetric lighting, lens flare, premium cinematic quality.`;

  const closingPrompt = `A cinematic "COMING SOON" title card for a movie trailer. Bold dramatic typography reading "COMING SOON" centered on a dark moody background. Film grain, dramatic lighting, professional movie marketing design, premium quality.`;

  const introSeed = Math.floor(Math.random() * 100000);
  const closingSeed = Math.floor(Math.random() * 100000);

  // Generate both in parallel
  const [introResult, closingResult] = await Promise.all([
    generateImage(introPrompt, introSeed, "16:9"),
    generateImage(closingPrompt, closingSeed, "16:9"),
  ]);

  const bookends = {};

  if (introResult.images && introResult.images.length > 0) {
    const introName = `${sessionId}_bookend_intro.png`;
    await downloadImage(introResult.images[0].url, introName);
    bookends.intro = { url: `/frames/${introName}`, prompt: introPrompt };
  }

  if (closingResult.images && closingResult.images.length > 0) {
    const closingName = `${sessionId}_bookend_closing.png`;
    await downloadImage(closingResult.images[0].url, closingName);
    bookends.closing = { url: `/frames/${closingName}`, prompt: closingPrompt };
  }

  return bookends;
}

// SSE endpoint: generate all videos (bookends + content)
app.post("/api/generate-videos", async (req, res) => {
  const { movieIdea, sceneUrls, sceneLabels, sessionId } = req.body;

  if (!sceneUrls || !Array.isArray(sceneUrls) || sceneUrls.length < 1) {
    return res.status(400).json({ error: "sceneUrls array required" });
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    const sid = sessionId || uuidv4().slice(0, 8);

    // Step 1: Generate bookend images
    send({ type: "status", status: "Generating studio intro and closing cards...", phase: "bookends" });

    let bookends;
    try {
      bookends = await generateBookendImages(sid, movieIdea);
      send({
        type: "bookends-ready",
        intro: bookends.intro,
        closing: bookends.closing,
        status: "Bookend images ready",
      });
    } catch (err) {
      send({ type: "error", status: `Bookend generation failed: ${err.message}` });
      bookends = {};
    }

    // Step 2: Generate video prompts via Claude
    send({ type: "status", status: "Generating cinematic motion prompts...", phase: "prompts" });
    const labels = sceneLabels || sceneUrls.map((_, i) => `Scene ${i + 1}`);
    const videoPrompts = await generateVideoPrompts(movieIdea, labels);

    send({ type: "prompts-ready", prompts: videoPrompts, status: "Motion prompts ready. Submitting video jobs..." });

    // Step 3: Prepare all jobs (bookend intro + content scenes + bookend closing)
    const allJobs = [];

    // Intro bookend
    if (bookends.intro) {
      allJobs.push({
        type: "bookend-intro",
        index: -1,
        imageUrl: bookends.intro.url,
        prompt: "Dramatic movie studio logo animation. Slow zoom in with golden light rays expanding, lens flare intensifying. Cinematic reveal.",
      });
    }

    // Content scenes
    for (let i = 0; i < sceneUrls.length; i++) {
      allJobs.push({
        type: "content",
        index: i,
        imageUrl: sceneUrls[i],
        prompt: videoPrompts[i] || `Cinematic scene motion, dramatic camera movement, movie trailer style.`,
      });
    }

    // Closing bookend
    if (bookends.closing) {
      allJobs.push({
        type: "bookend-closing",
        index: -2,
        imageUrl: bookends.closing.url,
        prompt: "COMING SOON text gently pulsing with dramatic light. Subtle lens flare and film grain. Slow cinematic fade.",
      });
    }

    // Step 4: Submit all Kling jobs
    send({ type: "status", status: `Submitting ${allJobs.length} video generation jobs...`, phase: "submitting" });

    const submissions = [];
    for (const job of allJobs) {
      const localPath = path.join(__dirname, job.imageUrl);
      let imageUri;
      if (fs.existsSync(localPath)) {
        imageUri = fileToDataUri(localPath);
      } else {
        imageUri = job.imageUrl;
      }

      try {
        const result = await submitKlingJob(imageUri, job.prompt, "5", "16:9");
        submissions.push({ ...job, requestId: result.request_id, status: "submitted" });
        send({
          type: "video-submitted",
          jobType: job.type,
          index: job.index,
          requestId: result.request_id,
          status: `${job.type === "content" ? `Scene ${job.index + 1}` : job.type} queued`,
        });
      } catch (err) {
        submissions.push({ ...job, error: err.message, status: "failed" });
        send({
          type: "video-error",
          jobType: job.type,
          index: job.index,
          status: `${job.type} submit failed: ${err.message}`,
        });
      }
    }

    const activeJobs = submissions.filter((s) => s.status === "submitted");
    if (activeJobs.length === 0) {
      send({ type: "error", status: "All video submissions failed" });
      res.end();
      return;
    }

    send({ type: "status", status: `${activeJobs.length} videos generating. Polling for results...`, phase: "polling" });

    // Step 5: Poll all jobs concurrently
    const pollPromises = activeJobs.map((job) =>
      pollKlingJob(job.requestId, (status, attempt) => {
        if (attempt % 6 === 0) {
          send({
            type: "video-polling",
            jobType: job.type,
            index: job.index,
            klingStatus: status,
            attempt,
          });
        }
      })
        .then(async (result) => {
          if (result.video && result.video.url) {
            const suffix = job.type === "bookend-intro" ? "intro" : job.type === "bookend-closing" ? "closing" : `scene_${String(job.index).padStart(2, "0")}`;
            const videoName = `${sid}_${suffix}.mp4`;
            const localUrl = await downloadVideo(result.video.url, videoName);

            send({
              type: "video-complete",
              jobType: job.type,
              index: job.index,
              url: localUrl,
              status: `${job.type === "content" ? `Scene ${job.index + 1}` : job.type} video complete`,
            });

            return { ...job, url: localUrl, status: "complete" };
          }
          throw new Error("No video in result");
        })
        .catch((err) => {
          send({
            type: "video-error",
            jobType: job.type,
            index: job.index,
            status: `${job.type} failed: ${err.message}`,
          });
          return { ...job, error: err.message, status: "failed" };
        })
    );

    const results = await Promise.allSettled(pollPromises);
    const completed = results
      .map((r) => (r.status === "fulfilled" ? r.value : null))
      .filter((v) => v && v.status === "complete");

    send({
      type: "all-videos-complete",
      total: allJobs.length,
      completed: completed.length,
      videos: completed,
      sessionId: sid,
    });
  } catch (err) {
    send({ type: "error", status: `Fatal error: ${err.message}` });
  }

  res.end();
});

// Regenerate a single video
app.post("/api/regenerate-video", async (req, res) => {
  const { imageUrl, prompt, index, jobType, sessionId } = req.body;

  if (!imageUrl || !prompt) {
    return res.status(400).json({ error: "imageUrl and prompt required" });
  }

  try {
    const localPath = path.join(__dirname, imageUrl);
    let imageUri;
    if (fs.existsSync(localPath)) {
      imageUri = fileToDataUri(localPath);
    } else {
      imageUri = imageUrl;
    }

    const submission = await submitKlingJob(imageUri, prompt, "5", "16:9");
    const result = await pollKlingJob(submission.request_id);

    if (result.video && result.video.url) {
      const sid = sessionId || uuidv4().slice(0, 8);
      const suffix = jobType === "bookend-intro" ? "intro" : jobType === "bookend-closing" ? "closing" : `scene_${String(index).padStart(2, "0")}`;
      const videoName = `${sid}_${suffix}_r${Date.now()}.mp4`;
      const localUrl = await downloadVideo(result.video.url, videoName);
      return res.json({ url: localUrl, index, jobType });
    }

    res.status(500).json({ error: "No video in result" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════
// Phase 4: Assemble Trailer (ffmpeg)
// ═══════════════════════════════════════════════════════
app.post("/api/assemble-trailer", async (req, res) => {
  const { videoUrls, sessionId } = req.body;

  if (!videoUrls || !Array.isArray(videoUrls) || videoUrls.length < 1) {
    return res.status(400).json({ error: "videoUrls array required" });
  }

  try {
    const sid = sessionId || uuidv4().slice(0, 8);
    const listFile = path.join(videosDir, `${sid}_concat_list.txt`);
    const outputFile = path.join(videosDir, `${sid}_final_trailer.mp4`);

    // Build ffmpeg concat list
    const lines = videoUrls.map((url) => {
      const localPath = path.join(__dirname, url);
      return `file '${localPath}'`;
    });
    fs.writeFileSync(listFile, lines.join("\n"));

    // Try concat demuxer (fast, no re-encode)
    try {
      execSync(`ffmpeg -y -f concat -safe 0 -i "${listFile}" -c copy "${outputFile}"`, { timeout: 60000 });
    } catch {
      // Fallback: re-encode for compatibility
      execSync(`ffmpeg -y -f concat -safe 0 -i "${listFile}" -c:v libx264 -preset fast -crf 23 -c:a aac "${outputFile}"`, { timeout: 120000 });
    }

    // Clean up list file
    fs.unlinkSync(listFile);

    res.json({ url: `/videos/${sid}_final_trailer.mp4` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`OJ Movie Maker running at http://localhost:${PORT}`);
});
