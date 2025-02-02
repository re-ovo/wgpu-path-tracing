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

  // Sort the subarray using quicksort
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

  const quickSort = (low: number, high: number) => {
    if (low < high) {
      const pi = partition(low, high);
      quickSort(low, pi - 1);
      quickSort(pi + 1, high);
    }
  };

  quickSort(start, end - 1);
}
