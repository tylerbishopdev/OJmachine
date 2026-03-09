export const maxDuration = 30;

const OPENROUTER_URL = "https://fal.run/openrouter/router";
const CLAUDE_MODEL = "anthropic/claude-sonnet-4-6";

function parseClaudeJSON(text) {
  const cleaned = text
    .replace(/```json\n?/g, "")
    .replace(/```\n?/g, "")
    .trim();
  return JSON.parse(cleaned);
}

export async function POST(request) {
  const { movieIdea, posterPrompt } = await request.json();
  if (!movieIdea || !posterPrompt) {
    return Response.json(
      { error: "movieIdea and posterPrompt required" },
      { status: 400 },
    );
  }

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

  try {
    const resp = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Key ${process.env.FAL_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        prompt: `Movie concept: "${movieIdea}"\nPoster style reference: "${posterPrompt}"`,
        system_prompt: systemPrompt,
        temperature: 0.7,
        max_tokens: 2000,
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return Response.json(
        { error: `Claude error ${resp.status}: ${errText}` },
        { status: 500 },
      );
    }

    const data = await resp.json();
    const text = (data.output || data.result || "").trim();

    let scenes;
    try {
      scenes = parseClaudeJSON(text);
      if (!Array.isArray(scenes) || scenes.length !== 7) {
        throw new Error("Expected 7 scenes");
      }
    } catch {
      scenes = [
        { scene: "Cinematic establishing shot of the movie world, OJ Simpson movie, dramatic lighting", label: "World Setup", beat: "World Setup" },
        { scene: "OJ Simpson dramatic character reveal, heroic pose, cinematic lighting", label: "OJ's Entrance", beat: "Character Intro" },
        { scene: "OJ Simpson facing a challenge, conflict begins, tense atmosphere", label: "Conflict Begins", beat: "Inciting Incident" },
        { scene: "OJ Simpson in intense action sequence, stakes rising, dramatic angles", label: "Stakes Rise", beat: "Rising Action" },
        { scene: "OJ Simpson at the peak dramatic moment, climax scene, explosive energy", label: "Climax", beat: "Climax Tease" },
        { scene: "OJ Simpson emotional character moment, close-up, contemplative lighting", label: "Reflection", beat: "Emotional Beat" },
        { scene: "OJ Simpson iconic final pose, dramatic silhouette, title card moment", label: "Final Shot", beat: "Final Hook" },
      ];
    }

    return Response.json({ scenes });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
