const axios = require('axios');

const GROQ_API_KEY = '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'; // Ganti dengan API key kamu

async function askGroq(prompt) {
  const { data } = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
    model: 'llama3-8b-8192', // Bisa ganti: llama3-70b-8192, mixtral-8x7b-32768, gemma-7b-it
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 1024,
    temperature: 0.7
  }, {
    headers: {
      'Authorization': `Bearer ${GROQ_API_KEY}`,
      'Content-Type': 'application/json'
    }
  });

  return data.choices?.[0]?.message?.content || 'Tidak ada respons';
}

module.exports = {
  name: "Groq AI",
  desc: "Chat Groq AI dengan model LLaMA3",
  category: "Artificial Intelligence",
  path: "/ai/groq?text=",
  async run(req, res) {
    const { text } = req.query;
    if (!text) return res.json({ status: false, error: 'Parameter text diperlukan' });

    try {
      const reply = await askGroq(text);
      res.json({ status: true, reply });
    } catch (err) {
      res.status(500).json({ status: false, error: err.message });
    }
  }
};