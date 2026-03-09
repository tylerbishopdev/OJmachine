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
  const { movieIdea, sceneLabels } = await request.json();
  if (!movieIdea || !sceneLabels) {
    return Response.json(
      { error: "movieIdea and sceneLabels required" },
      { status: 400 },
    );
  }

  const systemPrompt = `You are a cinematic video director creating motion prompts for a movie trailer. For each scene, write a brief motion/action description that will bring the still image to life as a 5-second video clip.

RULES:
- Describe specific camera movements (slow zoom, pan, dolly, crane shot)
- Describe subtle character motion (breathing, turning, walking)
- Specify atmosphere (wind, rain, light shifts)
- Keep each prompt under 40 words
- Focus on MOTION and CHANGE, not static description
- Make it feel like a real movie trailer

Return ONLY a JSON array of strings, one prompt per scene. No markdown.`;

  try {
    const resp = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Key ${process.env.FAL_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        prompt: `Movie: "${movieIdea}"\nScenes: ${JSON.stringify(sceneLabels)}`,
        system_prompt: systemPrompt,
        temperature: 0.7,
        max_tokens: 1500,
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

    let prompts;
    try {
      prompts = parseClaudeJSON(text);
      if (!Array.isArray(prompts) || prompts.length === 0) {
        throw new Error("Expected array of prompts");
      }
      while (prompts.length < sceneLabels.length) {
        prompts.push(prompts[prompts.length - 1]);
      }
      prompts = prompts.slice(0, sceneLabels.length);
    } catch {
      prompts = sceneLabels.map(
        (label, i) =>
          `Cinematic motion: slow dramatic camera movement, subtle character motion, atmospheric effects. Movie trailer scene ${i + 1}: ${label}. Professional cinematography.`,
      );
    }

    return Response.json({ prompts });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
