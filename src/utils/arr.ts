export function sortArrayPartially<T>(
  arr: T[],
  start: number,
  end: number,
  compare: (a: T, b: T) => number,
) {
  // Validate input indices
  if (start < 0 || end > arr.length || start >= end) {
    throw new Error('Invalid indices: start=' + start + ', end=' + end);
  }

  // Insertion sort for small subarrays
  const insertionSort = (low: number, high: number) => {
    for (let i = low + 1; i <= high; i++) {
      const key = arr[i];
      let j = i - 1;
      while (j >= low && compare(arr[j], key) > 0) {
        arr[j + 1] = arr[j];
        j--;
      }
      arr[j + 1] = key;
    }
  };

  // Choose median of three as pivot
  const medianOfThree = (low: number, high: number): number => {
    const mid = low + ((high - low) >> 1);

    // Sort low, mid, high elements
    if (compare(arr[low], arr[mid]) > 0) {
      [arr[low], arr[mid]] = [arr[mid], arr[low]];
    }
    if (compare(arr[mid], arr[high]) > 0) {
      [arr[mid], arr[high]] = [arr[high], arr[mid]];
      if (compare(arr[low], arr[mid]) > 0) {
        [arr[low], arr[mid]] = [arr[mid], arr[low]];
      }
    }
    return mid;
  };

  const partition = (low: number, high: number): number => {
    if (high - low > 10) {
      // Only use median-of-three for larger subarrays
      const pivotIndex = medianOfThree(low, high);
      // Move pivot to the end
      [arr[pivotIndex], arr[high]] = [arr[high], arr[pivotIndex]];
    }

    const pivot = arr[high];
    let i = low - 1;

    for (let j = low; j < high; j++) {
      if (compare(arr[j], pivot) <= 0) {
        i++;
        if (i !== j) {
          [arr[i], arr[j]] = [arr[j], arr[i]];
        }
      }
    }

    if (i + 1 !== high) {
      [arr[i + 1], arr[high]] = [arr[high], arr[i + 1]];
    }
    return i + 1;
  };

  // Use a stack to simulate recursion
  const stack: number[] = [];
  stack.push(start);
  stack.push(end - 1);

  while (stack.length > 0) {
    const high = stack.pop()!;
    const low = stack.pop()!;

    if (high - low < 10) {
      // Use insertion sort for small subarrays
      insertionSort(low, high);
    } else if (low < high) {
      const pivotIndex = partition(low, high);

      // Push the larger subarray first (to ensure stack depth is O(log n))
      if (pivotIndex - low < high - pivotIndex) {
        // Push the right part onto stack
        if (pivotIndex + 1 < high) {
          stack.push(pivotIndex + 1);
          stack.push(high);
        }
        // Push the left part onto stack
        if (pivotIndex - 1 > low) {
          stack.push(low);
          stack.push(pivotIndex - 1);
        }
      } else {
        // Push the left part onto stack
        if (pivotIndex - 1 > low) {
          stack.push(low);
          stack.push(pivotIndex - 1);
        }
        // Push the right part onto stack
        if (pivotIndex + 1 < high) {
          stack.push(pivotIndex + 1);
          stack.push(high);
        }
      }
    }
  }
}
