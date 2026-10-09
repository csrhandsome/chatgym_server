import { describe, expect, test } from 'bun:test';
import { sanitizeMainBlocks } from '../../planning/workflows/plan-sanitize';

describe('sanitizeMainBlocks', () => {
  test('coerces string sets/reps into integers and resolves supported names', () => {
    const [block] = sanitizeMainBlocks([
      {
        title: '主项',
        purpose: '胸部',
        exercises: [
          { name: 'bench press', sets: '4', reps: '8', restSeconds: '90', primaryMuscles: ['胸'] },
        ],
      },
    ]) as Array<{ exercises: Array<Record<string, unknown>> }>;

    expect(block?.exercises[0]).toMatchObject({
      name: '卧推',
      sets: 4,
      reps: 8,
      restSeconds: 90,
    });
  });

  test('falls back to the catalog muscles when the model omits or mangles them', () => {
    const blocks = sanitizeMainBlocks([
      {
        title: '收尾',
        purpose: '手臂',
        exercises: [
          { name: '哑铃弯举', sets: 3, reps: 12, restSeconds: 60 },
          { name: '坐姿划船', sets: 3, reps: 10, restSeconds: 90, primaryMuscles: ['未知肌肉'] },
        ],
      },
    ]) as Array<{ exercises: Array<Record<string, unknown>> }>;

    const [biceps, row] = blocks[0]?.exercises ?? [];

    // Missing primaryMuscles must not sanitize to an empty array (schema requires >= 1).
    expect(biceps?.primaryMuscles).toEqual(['手臂']);
    // An unrecognized muscle name also falls back rather than emptying out.
    expect(row?.primaryMuscles).toEqual(['背']);
  });

  test('keeps a valid primaryMuscles list untouched', () => {
    const [block] = sanitizeMainBlocks([
      {
        title: '主项',
        purpose: '腿部',
        exercises: [
          { name: '杠铃深蹲', sets: 4, reps: 8, restSeconds: 120, primaryMuscles: ['腿', '臀'] },
        ],
      },
    ]) as Array<{ exercises: Array<Record<string, unknown>> }>;

    expect(block?.exercises[0]?.primaryMuscles).toEqual(['腿', '臀']);
  });
});
