export const maxDuration = 30;

const OPENROUTER_URL = "https://fal.run/openrouter/router";
const CLAUDE_MODEL = "anthropic/claude-sonnet-4-6";

export async function POST(request) {
  const { movieIdea } = await request.json();
  if (!movieIdea) {
    return Response.json({ error: "movieIdea required" }, { status: 400 });
  }

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

  try {
    const resp = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Key ${process.env.FAL_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        prompt: `Movie idea: "${movieIdea}"`,
        system_prompt: systemPrompt,
        temperature: 0.7,
        max_tokens: 500,
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
    const prompt = (data.output || data.result || "").trim();
    return Response.json({ prompt });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
