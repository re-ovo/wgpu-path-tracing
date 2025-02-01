import { Vec3, vec3 } from 'wgpu-matrix';
import { TriangleCPU } from './gpu';

interface AABB {
  min: Vec3;
  max: Vec3;
}

export interface BVHNode {
  aabb: AABB;
  left: number;
  right: number;
  triangleOffset: number;
  triangleCount: number;
}

const MAX_TRIANGLES_PER_NODE = 4;

function computeAABB(triangles: TriangleCPU[]): AABB {
  const min = vec3.create(Infinity, Infinity, Infinity);
  const max = vec3.create(-Infinity, -Infinity, -Infinity);

  for (const tri of triangles) {
    vec3.min(min, tri.v0, min);
    vec3.min(min, tri.v1, min);
    vec3.min(min, tri.v2, min);
    vec3.max(max, tri.v0, max);
    vec3.max(max, tri.v1, max);
    vec3.max(max, tri.v2, max);
  }

  return { min, max };
}

function computeCentroid(triangle: TriangleCPU): Vec3 {
  return vec3.scale(
    vec3.add(vec3.add(triangle.v0, triangle.v1), triangle.v2),
    1 / 3,
  );
}

export function buildBVH(triangles: TriangleCPU[]): BVHNode[] {
  console.log(`Starting BVH build with ${triangles.length} triangles`);
  const nodes: BVHNode[] = [];
  const triangleIndices = new Array(triangles.length);
  for (let i = 0; i < triangles.length; i++) {
    triangleIndices[i] = i;
  }

  // 工作队列，存储待处理的节点信息
  interface WorkItem {
    start: number;
    count: number;
    nodeIndex: number;
  }
  const workQueue: WorkItem[] = [];

  // 创建根节点
  const rootAABB = computeAABB(triangles);
  nodes.push({
    aabb: rootAABB,
    left: 0xffffffff,
    right: 0xffffffff,
    triangleOffset: 0,
    triangleCount: triangles.length,
  });

  // 将根节点加入工作队列
  workQueue.push({
    start: 0,
    count: triangles.length,
    nodeIndex: 0,
  });

  // 迭代处理每个节点
  while (workQueue.length > 0) {
    const { start, count, nodeIndex } = workQueue.pop()!;
    console.log(
      `Processing node ${nodeIndex} with ${count} triangles (start: ${start})`,
    );

    // 如果三角形数量小于阈值，保持为叶子节点
    if (count <= MAX_TRIANGLES_PER_NODE) {
      console.log(
        `Node ${nodeIndex} is a leaf node (triangles <= ${MAX_TRIANGLES_PER_NODE})`,
      );
      continue;
    }

    const node = nodes[nodeIndex];
    const aabb = node.aabb;

    // 找出最长轴
    const extent = vec3.sub(aabb.max, aabb.min);
    let axis = 0;
    if (extent[1] > extent[0]) axis = 1;
    if (extent[2] > extent[axis]) axis = 2;
    console.log(`Splitting along axis ${axis}, extent: ${extent}`);

    // 按中点分割
    const splitPos = (aabb.min[axis] + aabb.max[axis]) * 0.5;

    // 对三角形进行排序
    let left = start;
    let right = start + count - 1;

    // 计算当前节点中三角形的质心
    const centroids = new Array(count);
    for (let i = 0; i < count; i++) {
      centroids[i] = computeCentroid(triangles[triangleIndices[start + i]]);
    }

    // 使用SAH（Surface Area Heuristic）来找到最佳分割点
    let bestCost = Infinity;
    let bestSplitPos = splitPos;
    let bestAxis = axis;

    // 尝试每个轴向的分割
    for (let testAxis = 0; testAxis < 3; testAxis++) {
      // 计算当前轴向的最小和最大值
      let minVal = Infinity;
      let maxVal = -Infinity;
      for (let i = 0; i < count; i++) {
        const val = centroids[i][testAxis];
        minVal = Math.min(minVal, val);
        maxVal = Math.max(maxVal, val);
      }

      // 如果范围太小，跳过这个轴向
      if (maxVal - minVal < 1e-4) continue;

      // 尝试几个不同的分割位置
      const numBins = 32;
      for (let bin = 1; bin < numBins; bin++) {
        const testSplitPos = minVal + (maxVal - minVal) * (bin / numBins);

        // 统计分割后左右两边的三角形数量
        let leftCount = 0;
        for (let i = 0; i < count; i++) {
          if (centroids[i][testAxis] < testSplitPos) {
            leftCount++;
          }
        }
        const rightCount = count - leftCount;

        // 如果任一边为空，跳过这个分割
        if (leftCount === 0 || rightCount === 0) continue;

        // 计算分割代价（简化版SAH）
        const cost = leftCount * rightCount;

        if (cost < bestCost) {
          bestCost = cost;
          bestSplitPos = testSplitPos;
          bestAxis = testAxis;
        }
      }
    }

    // 使用最佳分割进行实际的分割
    left = start;
    right = start + count - 1;
    const finalSplitPos = bestSplitPos;
    axis = bestAxis;

    while (left <= right) {
      while (
        left <= right &&
        computeCentroid(triangles[triangleIndices[left]])[axis] < finalSplitPos
      ) {
        left++;
      }
      while (
        left <= right &&
        computeCentroid(triangles[triangleIndices[right]])[axis] >=
          finalSplitPos
      ) {
        right--;
      }
      if (left < right) {
        const temp = triangleIndices[left];
        triangleIndices[left] = triangleIndices[right];
        triangleIndices[right] = temp;
        left++;
        right--;
      }
    }

    // 如果无法分割，保持为叶子节点
    if (left <= start || left >= start + count) {
      console.log(
        `Node ${nodeIndex} cannot be split (left: ${left}, start: ${start}, count: ${count})`,
      );
      continue;
    }

    // 创建子节点
    const leftCount = left - start;
    const rightCount = count - leftCount;
    console.log(
      `Split succeeded - left: ${leftCount} triangles, right: ${rightCount} triangles`,
    );

    // 创建左子节点
    const leftChildIndex = nodes.length;
    const leftChildAABB = computeAABB(
      triangleIndices.slice(start, start + leftCount).map((i) => triangles[i]),
    );
    nodes.push({
      aabb: leftChildAABB,
      left: 0xffffffff,
      right: 0xffffffff,
      triangleOffset: start,
      triangleCount: leftCount,
    });

    // 创建右子节点
    const rightChildIndex = nodes.length;
    const rightChildAABB = computeAABB(
      triangleIndices.slice(left, left + rightCount).map((i) => triangles[i]),
    );
    nodes.push({
      aabb: rightChildAABB,
      left: 0xffffffff,
      right: 0xffffffff,
      triangleOffset: left,
      triangleCount: rightCount,
    });

    // 更新当前节点
    nodes[nodeIndex].left = leftChildIndex;
    nodes[nodeIndex].right = rightChildIndex;
    nodes[nodeIndex].triangleCount = 0;

    // 将子节点加入工作队列
    workQueue.push({
      start: start,
      count: leftCount,
      nodeIndex: leftChildIndex,
    });
    workQueue.push({
      start: left,
      count: rightCount,
      nodeIndex: rightChildIndex,
    });
  }

  // 重新排序三角形数组以匹配BVH结构
  const reorderedTriangles = new Array(triangles.length);
  for (let i = 0; i < triangles.length; i++) {
    reorderedTriangles[i] = triangles[triangleIndices[i]];
  }
  triangles.length = 0;
  triangles.push(...reorderedTriangles);

  console.log(
    `BVH built with ${nodes.length} nodes, max triangles per node: ${MAX_TRIANGLES_PER_NODE}`,
  );

  return nodes;
}
