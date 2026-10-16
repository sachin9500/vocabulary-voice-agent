VocabVoice - deploy on Vercel (free)

1. Get free API keys (any one is enough, more = automatic fallback):
   - Gemini:     aistudio.google.com -> Get API key
   - Groq:       console.groq.com/keys
   - OpenRouter: openrouter.ai/keys  (free models end in ":free", about 50 requests/day)
2. Create a free GitHub account, make a new repository, and upload these files
   (index.html, api/chat.js, README.md) keeping the api folder.
3. vercel.com -> sign up with GitHub -> Add New Project -> import the repository -> Deploy.
4. Project -> Settings -> Environment Variables. Add the keys you have:
   GEMINI_API_KEY, GROQ_API_KEY, OPENROUTER_API_KEY
   Optional model overrides: GEMINI_MODEL, GROQ_MODEL, OPENROUTER_MODEL
5. Deployments -> Redeploy (so the keys take effect). Share the .vercel.app link.
