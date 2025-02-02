import { describe, it, expect } from 'vitest';
import { sortArrayPartially } from '../utils/arr';

describe('sortArrayPartially', () => {
  it('should sort a portion of an array correctly', () => {
    const arr = [5, 2, 8, 1, 9, 3, 7];
    sortArrayPartially(arr, 1, 4, (a, b) => a - b);
    expect(arr).toEqual([5, 1, 2, 8, 9, 3, 7]);
  });

  it('should handle array with duplicate values', () => {
    const arr = [3, 3, 2, 2, 1, 1];
    sortArrayPartially(arr, 0, 4, (a, b) => a - b);
    expect(arr).toEqual([2, 2, 3, 3, 1, 1]);
  });

  it('should handle single element range', () => {
    const arr = [5, 2, 8, 1, 9];
    sortArrayPartially(arr, 2, 3, (a, b) => a - b);
    expect(arr).toEqual([5, 2, 8, 1, 9]);
  });

  it('should handle custom compare function', () => {
    const arr = ['banana', 'apple', 'cherry', 'date'];
    sortArrayPartially(arr, 0, 3, (a, b) => b.localeCompare(a)); // reverse alphabetical
    expect(arr).toEqual(['cherry', 'banana', 'apple', 'date']);
  });

  it('should throw error for invalid indices', () => {
    const arr = [1, 2, 3, 4, 5];

    expect(() => {
      sortArrayPartially(arr, -1, 3, (a, b) => a - b);
    }).toThrow('Invalid indices');

    expect(() => {
      sortArrayPartially(arr, 3, 2, (a, b) => a - b);
    }).toThrow('Invalid indices');

    expect(() => {
      sortArrayPartially(arr, 0, 6, (a, b) => a - b);
    }).toThrow('Invalid indices');
  });
});
