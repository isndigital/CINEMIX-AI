
import Anthropic from '@anthropic-ai/sdk';

export async function rewritePromptWithClaude(
  originalPrompt: string, 
  errorReason: string, 
  apiKey: string,
  sceneId: number
): Promise<string> {
  const anthropic = new Anthropic({
    apiKey: apiKey,
    dangerouslyAllowBrowser: true // Essential for client-side demo/internal tools
  });

  const systemPrompt = `
    Eres un experto en ingeniería de prompts cinematográficos. 
    Tu tarea es REESCRIBIR un prompt que fue rechazado por filtros de seguridad o políticas de contenido, manteniendo la esencia visual pero eliminando cualquier palabra o concepto que pueda activar sensores de seguridad (violencia, contenido explícito, marcas registradas, etc.).
    
    REGLAS:
    1. Mantén un estilo fotorrealista y cinematográfico.
    2. Usa lenguaje metafórico o descriptivo indirecto para evitar términos sensibles.
    3. El resultado debe ser un prompt en INGLÉS.
    4. El prompt DEBE COMENZAR con el prefijo "Cena ${sceneId.toString().padStart(2, '0')}: ".
    5. NO incluyas introducciones, solo el novo prompt.
  `;

  try {
    const msg = await anthropic.messages.create({
      model: "claude-3-5-sonnet-latest",
      max_tokens: 1024,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: `Original Prompt: "${originalPrompt}"\nError Reason: ${errorReason}\n\nReescribe este prompt para que sea seguro pero visualmente impactante.`
        }
      ],
    });

    // @ts-ignore - SDK type differences
    const result = msg.content[0].text.trim();
    if (!result.toLowerCase().startsWith("cena")) {
      return `Cena ${sceneId.toString().padStart(2, '0')}: ${result}`;
    }
    return result;
  } catch (error) {
    console.error("Claude Rewrite Error:", error);
    throw error;
  }
}
