import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

async function startServer() {
  const app = express();

  app.use(express.json({ limit: '6mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'pacto-protocolo' });
  });

  app.post('/api/analyze-context', async (req, res) => {
    try {
      if (!process.env.GEMINI_API_KEY) {
        res.status(503).json({
          error:
            'GEMINI_API_KEY no está configurada en el servidor. Configúrala en Settings > Secrets para habilitar la verificación visual contextual.',
        });
        return;
      }

      const { imageBase64, mimeType, folioHash, cecofamSede } = req.body ?? {};

      if (typeof imageBase64 !== 'string' || imageBase64.length < 32 || imageBase64.length > 5_500_000) {
        res.status(400).json({ error: 'Imagen ofuscada inválida o fuera de tamaño permitido.' });
        return;
      }

      const allowedMimes = ['image/jpeg', 'image/png', 'image/webp'];
      if (typeof mimeType !== 'string' || !allowedMimes.includes(mimeType)) {
        res.status(400).json({ error: 'Formato MIME no soportado. Usa JPEG, PNG o WebP.' });
        return;
      }

      const safeFolio = typeof folioHash === 'string' ? folioHash.slice(0, 16) : 'N/A';
      const safeSede = typeof cecofamSede === 'string' ? cecofamSede.slice(0, 40) : 'Estado de México';

      const prompt = [
        'Actúa como módulo de verificación contextual del Protocolo PACTO (Bloque VIII: Procesamiento Visual F-BLUR).',
        'Recibes una fotografía YA DEGRADADA mediante desenfoque gaussiano destructivo (r >= 35 px) para proteger la identidad y privacidad del menor y adultos.',
        `Contexto de sesión: Folio parcial ${safeFolio}, Sede ${safeSede}.`,
        'Evalúa únicamente las frecuencias bajas del entorno (iluminación, colores, entorno abierto o cerrado) SIN intentar identificar rostros, personas ni menores.',
        'Responde estrictamente en español con tono jurídico-técnico neutral.',
      ].join(' ');

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: {
          parts: [
            {
              inlineData: {
                mimeType,
                data: imageBase64,
              },
            },
            { text: prompt },
          ],
        },
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              entornoLicito: {
                type: Type.BOOLEAN,
                description: 'Indica si el entorno visual general es compatible con un espacio lícito y adecuado para convivencia familiar.',
              },
              tipoEspacio: {
                type: Type.STRING,
                description: 'Categoría general del espacio observado por frecuencias bajas (ej. Parque o área abierta, Centro comercial, Interior habitacional, Tránsito urbano).',
              },
              observacionNeutral: {
                type: Type.STRING,
                description: 'Descripción fáctica y neutral de 1 a 2 oraciones sobre el contexto ambiental, sin juicios de valor ni referencia a identidad personal.',
              },
              cumplePrivacidadFBlur: {
                type: Type.BOOLEAN,
                description: 'Confirma si la imagen presenta degradación visual suficiente que impide reconocer rasgos faciales.',
              },
            },
            required: ['entornoLicito', 'tipoEspacio', 'observacionNeutral', 'cumplePrivacidadFBlur'],
          },
        },
      });

      const rawText = (response.text ?? '{}').trim();
      const parsed = JSON.parse(rawText);
      res.json({
        analysis: parsed,
        modelUsed: 'gemini-4-hydrogen',
        analyzedAtUtc: new Date().toISOString(),
      });
    } catch (err) {
      console.error('Error en /api/analyze-context:', err);
      const message = err instanceof Error ? err.message : 'Error al procesar análisis contextual';
      res.status(502).json({ error: `No se pudo completar el análisis contextual: ${message}` });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`PACTO server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
