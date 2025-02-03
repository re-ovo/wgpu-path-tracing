import { vec3 } from 'wgpu-matrix';
import AABB, { Axis } from '../utils/aabb';
import { TriangleCPU } from './gpu';
import { sortArrayPartially } from '../utils/arr';

export interface BVHNode {
  aabb: AABB;
  left: number;
  right: number;
  triangleOffset: number;
  triangleCount: number;
}

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

  return new AABB(min, max);
}

interface BuildTask {
  nodeIndex: number;
  startIndex: number;
  endIndex: number;
}

/**
 * Build options
 *
 * @param maxTrianglesPerLeaf - 最大三角形数量 (default: 4)
 * @param numOfBins - 分割轴的bin数量 (default: 12)
 */
interface BuildOptions {
  maxTrianglesPerLeaf: number;
  numOfBins: number;
}

/**
 * 构建BVH
 *
 * @param triangles - 三角形
 * @param options - 构建选项
 */
export function buildBVH(
  triangles: TriangleCPU[],
  options: Partial<BuildOptions> = {},
): BVHNode[] {
  console.log(`Starting BVH build with ${triangles.length} triangles`);

  const nodes: BVHNode[] = [];
  const workQueue: BuildTask[] = [];

  // 创建根节点
  const rootAABB = computeAABB(triangles);

  nodes.push({
    aabb: rootAABB,
    left: -1,
    right: -1,
    triangleOffset: 0,
    triangleCount: triangles.length,
  });

  // 将根节点任务添加到队列中
  workQueue.push({
    nodeIndex: 0,
    startIndex: 0,
    endIndex: triangles.length,
  });

  while (workQueue.length > 0) {
    const task = workQueue.pop()!;
    const node = nodes[task.nodeIndex];
    const numTriangles = task.endIndex - task.startIndex;

    // 如果三角形数量小于等于最大三角形数量，则标记为叶节点
    if (numTriangles <= (options.maxTrianglesPerLeaf ?? 4)) {
      node.left = -1;
      node.right = -1;
      node.triangleOffset = task.startIndex;
      node.triangleCount = numTriangles;
      continue;
    }

    // 非叶节点，需要进行分割
    // 首先，需要找到最佳的分割轴
    const aabb = computeAABB(triangles.slice(task.startIndex, task.endIndex));
    const splitAxis: Axis = aabb.getMaxExtentAxis();

    // 对三角形进行排序
    sortArrayPartially(triangles, task.startIndex, task.endIndex, (a, b) =>
      compareTriangles(a, b, splitAxis),
    );

    // 使用SAH算法找到最佳的分割点
    const bestSplit = findBestSplit(
      triangles,
      task.startIndex,
      task.endIndex,
      splitAxis,
      options.numOfBins ?? 12,
    );

    // 创建新的节点
    const leftNode = {
      aabb: computeAABB(triangles.slice(task.startIndex, bestSplit)),
      left: -1,
      right: -1,
      triangleOffset: task.startIndex,
      triangleCount: bestSplit - task.startIndex,
    };
    const rightNode = {
      aabb: computeAABB(triangles.slice(bestSplit, task.endIndex)),
      left: -1,
      right: -1,
      triangleOffset: bestSplit,
      triangleCount: task.endIndex - bestSplit,
    };

    // 将新的节点添加到nodes数组中
    nodes.push(leftNode, rightNode);

    // 更新当前节点的子节点索引
    node.left = nodes.length - 2;
    node.right = nodes.length - 1;

    // 既然已经分割了，那么当前节点的三角形数量和偏移量都为0，这样就标记为叶节点
    node.triangleCount = 0;
    node.triangleOffset = 0;

    // 将新的任务添加到workQueue中
    workQueue.push({
      nodeIndex: nodes.length - 2,
      startIndex: task.startIndex,
      endIndex: bestSplit,
    });

    workQueue.push({
      nodeIndex: nodes.length - 1,
      startIndex: bestSplit,
      endIndex: task.endIndex,
    });
  }

  console.log(`BVH build completed with ${nodes.length} nodes`);

  return nodes;
}

// 根据给定的轴，比较两个三角形
// compare the triangles based on the given axis
function compareTriangles(a: TriangleCPU, b: TriangleCPU, axis: Axis) {
  return getTriangleCenter(a, axis) - getTriangleCenter(b, axis);
}

// 获取三角形的中心点
// get the center point of the triangle
function getTriangleCenter(triangle: TriangleCPU, axis: Axis) {
  return (triangle.v0[axis] + triangle.v1[axis] + triangle.v2[axis]) / 3;
}

// 找到最佳的分割点
// find the best split point
function findBestSplit(
  triangles: TriangleCPU[],
  startIndex: number,
  endIndex: number,
  axis: Axis,
  numOfBins: number,
) {
  let minCost = Infinity;
  let bestSplitIndex = startIndex;

  const numTriangles = endIndex - startIndex;

  for (let i = 1; i < numOfBins; i++) {
    const ratio = i / numOfBins;
    const splitIndex = startIndex + Math.floor(numTriangles * ratio);

    if (splitIndex === startIndex || splitIndex === endIndex) {
      // 分割在AABB的边界上，跳过
      continue;
    }

    const cost = computeSAH(triangles, startIndex, endIndex, axis, splitIndex);
    if (cost < minCost) {
      minCost = cost;
      bestSplitIndex = splitIndex;
    }
  }

  return bestSplitIndex;
}

// 遍历代价
// traversal cost
const TRAVERSAL_COST = 1.0;
// 相交测试代价
// intersection test cost
const INTERSECTION_TEST_COST = 2.0;

// SAH Cost Function
// SAH代价 = 遍历代价 + (左子树面积/父节点面积 * 左子树三角形数量 + 右子树面积/父节点面积 * 右子树三角形数量) * 相交测试代价
// SAH cost = traversal cost + (left subtree area / parent node area * left subtree triangle count + right subtree area / parent node area * right subtree triangle count) * intersection test cost
function computeSAH(
  triangles: TriangleCPU[],
  startIndex: number,

  endIndex: number,
  axis: Axis,
  splitIndex: number,
) {
  const leftAABB = computeAABB(triangles.slice(startIndex, splitIndex));
  const rightAABB = computeAABB(triangles.slice(splitIndex, endIndex));

  const leftCost = leftAABB.getSurfaceArea() * (splitIndex - startIndex);
  const rightCost = rightAABB.getSurfaceArea() * (endIndex - splitIndex);

  return TRAVERSAL_COST + (leftCost + rightCost) * INTERSECTION_TEST_COST;
}
