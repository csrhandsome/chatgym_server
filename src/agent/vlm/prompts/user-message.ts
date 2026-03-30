import type { ModelMessage } from 'ai';
import type { VlmAnalyzeRequest } from '../../shared/types';

const toImagePart = (image: VlmAnalyzeRequest['images'][number]) => ({
  type: 'image' as const,
  image: image.image,
  providerOptions:
    image.detail === 'auto'
      ? undefined
      : {
          openai: {
            imageDetail: image.detail,
          },
        },
});

export const buildVlmMessages = (request: VlmAnalyzeRequest): ModelMessage[] => {
  const prompt = `
Frontend image prompt:
${request.prompt ?? 'No explicit image prompt was supplied.'}

Preferred task:
${request.preferredTask ?? 'Infer the best task from the image and prompt.'}

Per-image declared purposes:
${JSON.stringify(request.images.map((image, index) => ({ index, purpose: image.purpose ?? null })), null, 2)}

Please analyze the attached image(s) and produce a structured result.
`.trim();

  return [
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: prompt,
        },
        ...request.images.map(toImagePart),
      ],
    },
  ];
};
