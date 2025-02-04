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

  // Sort the subarray using iterative quicksort
  const partition = (low: number, high: number): number => {
    const pivot = arr[high];
    let i = low - 1;

    for (let j = low; j < high; j++) {
      if (compare(arr[j], pivot) <= 0) {
        i++;
        // Swap elements
        const temp = arr[i];
        arr[i] = arr[j];
        arr[j] = temp;
      }
    }

    // Place pivot in correct position
    const temp = arr[i + 1];
    arr[i + 1] = arr[high];
    arr[high] = temp;

    return i + 1;
  };

  // Use a stack to simulate recursion
  const stack: number[] = [];
  stack.push(start);
  stack.push(end - 1);

  while (stack.length > 0) {
    const high = stack.pop()!;
    const low = stack.pop()!;

    if (low < high) {
      const pivotIndex = partition(low, high);

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
