import type { ImagePart as SDKImagePart } from 'ai';
import type { VlmAnalyzeRequest } from './types';

type ImageInput = VlmAnalyzeRequest['images'][number];

const hasImageSignature = (data: Uint8Array, mediaType: string): boolean => {
  const startsWith = (signature: number[]) =>
    signature.every((byte, index) => data[index] === byte);

  switch (mediaType) {
    case 'image/png':
      return startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'image/jpeg':
      return startsWith([0xff, 0xd8, 0xff]);
    case 'image/gif':
      return startsWith([...Buffer.from('GIF87a')]) || startsWith([...Buffer.from('GIF89a')]);
    case 'image/webp':
      return data.length >= 12 && startsWith([...Buffer.from('RIFF')]) &&
        Buffer.from(data.subarray(8, 12)).toString('ascii') === 'WEBP';
    default:
      throw new Error('Unsupported inline image media type; use PNG, JPEG, GIF or WebP.');
  }
};

export const toSdkImagePart = ({ image, detail }: ImageInput): SDKImagePart => {
  const source = image.trim();
  let content: SDKImagePart['image'];
  let mediaType: string | undefined;

  if (/^data:/i.test(source)) {
    const match = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/]+={0,2})$/i.exec(source);

    if (!match) {
      throw new Error('Invalid image data URL; expected an image media type and base64 data.');
    }

    mediaType = match[1]!.toLowerCase();
    if (mediaType === 'image/jpg') mediaType = 'image/jpeg';
    const encoded = match[2]!;
    const data = Buffer.from(encoded, 'base64');

    // Buffer.from silently accepts truncated and malformed base64. Check a
    // canonical round trip, accepting both padded and unpadded camera input.
    if (!data.length || data.toString('base64').replace(/=+$/, '') !== encoded.replace(/=+$/, '') ||
        (encoded.includes('=') && encoded !== data.toString('base64'))) {
      throw new Error('Invalid base64 image data.');
    }
    if (!hasImageSignature(data, mediaType)) {
      throw new Error('Inline image bytes do not match the declared media type.');
    }

    content = data;
  } else {
    let url: URL;
    try {
      url = new URL(source);
    } catch {
      throw new Error('Invalid image URL; use an HTTP(S) URL or a base64 image data URL.');
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new Error('Unsupported image URL scheme; use HTTP or HTTPS.');
    }
    content = url;
  }

  return {
    type: 'image',
    image: content,
    ...(mediaType ? { mediaType } : {}),
    ...(detail && detail !== 'auto' ? {
      providerOptions: {
        openai: { imageDetail: detail },
        // The compatible provider merges raw part metadata instead of reading
        // OpenAI's imageDetail option. Supply the complete image_url object.
        openaiCompatible: {
          image_url: {
            url: content instanceof URL
              ? content.toString()
              : `data:${mediaType};base64,${Buffer.from(content as Uint8Array).toString('base64')}`,
            detail,
          },
        },
      },
    } : {}),
  };
};
