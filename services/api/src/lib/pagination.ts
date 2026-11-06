export interface PageRequest {
  page: number;
  pageSize: number;
}

export interface PaginatedResult<T> {
  items: T[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

export function pageMeta(request: PageRequest, total: number) {
  return {
    page: request.page,
    pageSize: request.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / request.pageSize)),
  };
}

export function skipTake(request: PageRequest) {
  return { skip: (request.page - 1) * request.pageSize, take: request.pageSize };
}

/** Splits a comma separated query value into a clean list. */
export function toList(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return (Array.isArray(value) ? value : value.split(",")).map((entry) => entry.trim()).filter(Boolean);
}
