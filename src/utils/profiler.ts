export class WebGPUProfiler {
  private device: GPUDevice;
  private querySetMap: Map<string, GPUQuerySet>;
  private queryBufferMap: Map<string, GPUBuffer>;
  private resultBufferMap: Map<string, GPUBuffer>;
  private queryResults: Map<string, number>;
  private statsProxy: { [key: string]: number };

  constructor(device: GPUDevice) {
    this.device = device;
    this.querySetMap = new Map();
    this.queryBufferMap = new Map();
    this.resultBufferMap = new Map();
    this.queryResults = new Map();
    this.statsProxy = new Proxy(
      {},
      {
        get: (target, prop) => {
          if (typeof prop === 'string') {
            return this.queryResults.get(prop) ?? 0;
          }
          return undefined;
        },
        set: () => false,
        has: (target, prop) => {
          return typeof prop === 'string' && this.queryResults.has(prop);
        },
        ownKeys: () => {
          return Array.from(this.queryResults.keys());
        },
        getOwnPropertyDescriptor: (target, prop) => {
          if (typeof prop === 'string' && this.queryResults.has(prop)) {
            return {
              enumerable: true,
              configurable: true,
              value: this.queryResults.get(prop),
            };
          }
          return undefined;
        },
      },
    );
  }

  private createQuerySetAndBuffer(label: string) {
    // 为每个label创建独立的queryset和buffer
    const querySet = this.device.createQuerySet({
      type: 'timestamp',
      count: 2, // 每个label只需要开始和结束两个时间戳
    });

    const queryBuffer = this.device.createBuffer({
      size: 16, // 2个时间戳，每个8字节
      usage:
        GPUBufferUsage.QUERY_RESOLVE |
        GPUBufferUsage.COPY_SRC |
        GPUBufferUsage.COPY_DST,
    });

    const resultBuffer = this.device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    this.querySetMap.set(label, querySet);
    this.queryBufferMap.set(label, queryBuffer);
    this.resultBufferMap.set(label, resultBuffer);

    return { querySet, queryBuffer, resultBuffer };
  }

  public getTimestampWrites(label: string) {
    let querySet = this.querySetMap.get(label);
    if (!querySet) {
      ({ querySet } = this.createQuerySetAndBuffer(label));
    }

    return {
      querySet,
      beginningOfPassWriteIndex: 0,
      endOfPassWriteIndex: 1,
    };
  }

  public resolveResults(commandEncoder: GPUCommandEncoder, label: string) {
    const querySet = this.querySetMap.get(label);
    const queryBuffer = this.queryBufferMap.get(label);
    const resultBuffer = this.resultBufferMap.get(label);

    if (!querySet || !queryBuffer || !resultBuffer) {
      console.warn(
        `No matching queryset/buffer/resultBuffer for label: ${label}`,
      );
      return;
    }

    // 解析时间戳查询结果
    commandEncoder.resolveQuerySet(querySet, 0, 2, queryBuffer, 0);

    // 将查询结果复制到结果缓冲区
    if (resultBuffer.mapState === 'unmapped') {
      commandEncoder.copyBufferToBuffer(
        queryBuffer,
        0,
        resultBuffer,
        0,
        resultBuffer.size,
      );
    }
  }

  public onSubmit() {
    for (const [label, resultBuffer] of this.resultBufferMap.entries()) {
      if (resultBuffer.mapState === 'unmapped') {
        resultBuffer.mapAsync(GPUMapMode.READ).then(() => {
          const data = new BigInt64Array(resultBuffer.getMappedRange());
          const startTime = Number(data[0]);
          const endTime = Number(data[1]);
          const duration = (endTime - startTime) * 1e-6; // 转换为毫秒
          this.queryResults.set(label, duration);
          resultBuffer.unmap();
        });
      }
    }
  }

  public destroy() {
    for (const querySet of this.querySetMap.values()) {
      querySet.destroy();
    }
    for (const buffer of this.queryBufferMap.values()) {
      buffer.destroy();
    }
    this.querySetMap.clear();
    this.queryBufferMap.clear();
  }

  public getStats(): { [key: string]: number } {
    return this.statsProxy;
  }
}
