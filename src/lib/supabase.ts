import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env['SUPABASE_URL'] ?? '';
const supabaseAnonKey = process.env['SUPABASE_ANON_KEY'] ?? '';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Helper to generate embedding using Jina (for semantic search)
export async function generateEmbedding(text: string): Promise<number[]> {
  const apiKey = process.env['JINA_API_KEY'];
  if (!apiKey) throw new Error('JINA_API_KEY environment variable is required');
  
  const response = await fetch('https://api.jina.ai/v3/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'jina-embeddings-v3',
      task: 'text-matching',
      input: [text],
    }),
  });

  if (!response.ok) {
    throw new Error(`Embedding failed: ${response.statusText}`);
  }

  const data = await response.json();
  return data.data[0].embedding;
}
