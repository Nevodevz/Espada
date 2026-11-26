import type {
  User, UserWithStats, Project, Task, Department, Board, BoardColumn,
  ProjectStatus, ColumnDef, SalesRecord, MarketingRecord,
  BoardShareStatus, BoardShareCreated, PublicBoard,
} from "./types";

import { readStoredValue } from "./storage";
import { apiErrorMessage } from "./apiError";

const TOKEN_KEY = "espada_token";
const LEGACY_TOKEN_KEY = "nevodevs_token";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return readStoredValue(TOKEN_KEY, LEGACY_TOKEN_KEY);
}
export function setToken(t: string) {
  localStorage.setItem(TOKEN_KEY, t);
  localStorage.removeItem(LEGACY_TOKEN_KEY);
}
export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(LEGACY_TOKEN_KEY);
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`/api${path}`, { ...options, headers });
  if (res.status === 401) {
    clearToken();
    // Public share pages must stay usable even if this browser happens to have
    // an expired employee token from an earlier Espada session.
    if (typeof window !== "undefined" && !window.location.pathname.startsWith("/share/")) {
      window.location.href = "/login";
    }
    throw new Error("Unauthorized");
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Ошибка запроса" }));
    // `detail` stays on the error: a 409 on POST /leads carries the existing lead.
    throw Object.assign(new Error(apiErrorMessage(err?.detail, res.status)), { status: res.status, detail: err?.detail });
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  async login(email: string, password: string): Promise<string> {
    const body = new URLSearchParams({ username: email, password });
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: "Ошибка входа" }));
      throw new Error(err.detail || "Неверный email или пароль");
    }
    const data = await res.json();
    setToken(data.access_token);
    return data.access_token;
  },
  me: () => request<User>("/auth/me"),
  logout: () => request<void>("/auth/logout", { method: "POST" }),

  // users
  listUsers: (deptId?: number, includeArchived = false) => {
    const p = new URLSearchParams();
    if (deptId) p.set("department_id", String(deptId));
    if (includeArchived) p.set("include_archived", "true");
    const qs = p.toString();
    return request<UserWithStats[]>(`/users${qs ? "?" + qs : ""}`);
  },
  getUser: (id: number) => request<UserWithStats>(`/users/${id}`),
  createUser: (data: any) => request<User>("/users", { method: "POST", body: JSON.stringify(data) }),
  updateUser: (id: number, data: any) => request<User>(`/users/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteUser: (id: number) => request<any>(`/users/${id}/archive`, { method: "POST" }),
  archiveUser: (id: number) => request<any>(`/users/${id}/archive`, { method: "POST" }),
  restoreUser: (id: number) => request<any>(`/users/${id}/restore`, { method: "POST" }),
  reassignBots: (fromId: number, toId: number) => request<any>(`/users/${fromId}/reassign-bots?new_owner_id=${toId}`, { method: "POST" }),
  userBotsCount: (id: number) => request<{ count: number }>(`/users/${id}/bots-count`),

  // avatars — multipart, so the JSON helper is bypassed deliberately
  uploadAvatar: async (userId: number, file: File): Promise<User> => {
    const token = getToken();
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`/api/users/${userId}/avatar`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: "Ошибка загрузки" }));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }
    return res.json();
  },
  deleteAvatar: (userId: number) => request<User>(`/users/${userId}/avatar`, { method: "DELETE" }),

  // departments
  listDepartments: () => request<Department[]>("/departments"),
  getDepartment: (slug: string) => request<Department>(`/departments/${slug}`),
  updateDepartment: (id: number, data: any) => request<Department>(`/departments/${id}`, { method: "PATCH", body: JSON.stringify(data) }),

  // projects
  listProjects: (filters?: { status?: ProjectStatus; owner_id?: number }) => {
    const p = new URLSearchParams();
    if (filters?.status) p.set("status", filters.status);
    if (filters?.owner_id) p.set("owner_id", String(filters.owner_id));
    const qs = p.toString();
    return request<Project[]>(`/projects${qs ? "?" + qs : ""}`);
  },
  createProject: (data: any) => request<Project>("/projects", { method: "POST", body: JSON.stringify(data) }),
  updateProject: (id: number, data: any) => request<Project>(`/projects/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteProject: (id: number) => request<void>(`/projects/${id}`, { method: "DELETE" }),
  // legacy aliases kept for compatibility during transition
  listServers: (filters?: { status?: ProjectStatus; owner_id?: number }) => {
    const p = new URLSearchParams();
    if (filters?.status) p.set("status", filters.status);
    if (filters?.owner_id) p.set("owner_id", String(filters.owner_id));
    const qs = p.toString();
    return request<Project[]>(`/projects${qs ? "?" + qs : ""}`);
  },
  createServer: (data: any) => request<Project>("/projects", { method: "POST", body: JSON.stringify(data) }),
  updateServer: (id: number, data: any) => request<Project>(`/projects/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteServer: (id: number) => request<void>(`/projects/${id}`, { method: "DELETE" }),

  // boards
  getPersonalBoard: (userId: number) => request<Board>(`/boards/personal/${userId}`),
  getBoard: (id: number) => request<Board>(`/boards/${id}`),
  boardsForDepartment: (deptId: number) => request<Board[]>(`/boards/by-department/${deptId}`),
  getBoardShare: (boardId: number) => request<BoardShareStatus>(`/boards/${boardId}/share`),
  createBoardShare: (boardId: number) =>
    request<BoardShareCreated>(`/boards/${boardId}/share`, { method: "POST" }),
  revokeBoardShare: (boardId: number) =>
    request<void>(`/boards/${boardId}/share`, { method: "DELETE" }),
  addColumn: (boardId: number, data: { name: string; color?: string; is_done?: boolean }) =>
    request<BoardColumn>(`/boards/${boardId}/columns`, { method: "POST", body: JSON.stringify(data) }),
  updateColumn: (colId: number, data: any) => request<BoardColumn>(`/boards/columns/${colId}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteColumn: (colId: number) => request<void>(`/boards/columns/${colId}`, { method: "DELETE" }),

  // tasks
  listTasks: (boardId: number, assigneeId?: number) => {
    const qs = assigneeId ? `&assignee_id=${assigneeId}` : "";
    return request<Task[]>(`/tasks?board_id=${boardId}${qs}`);
  },
  createTask: (data: any) => request<Task>("/tasks", { method: "POST", body: JSON.stringify(data) }),
  updateTask: (id: number, data: any) => request<Task>(`/tasks/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  /** Returns every task in the affected columns, already renumbered by the server. */
  moveTask: (id: number, column_id: number, position: number) =>
    request<{ tasks: Task[] }>(`/tasks/${id}/move`, { method: "PATCH", body: JSON.stringify({ column_id, position }) }),
  completeTask: (id: number) => request<Task>(`/tasks/${id}/complete`, { method: "PATCH" }),
  deleteTask: (id: number) => request<void>(`/tasks/${id}`, { method: "DELETE" }),

  // sales
  salesColumns: () => request<ColumnDef[]>("/sales/columns"),
  addSalesColumn: (data: { label: string; kind?: string }) => request<ColumnDef>("/sales/columns", { method: "POST", body: JSON.stringify(data) }),
  deleteSalesColumn: (id: number) => request<void>(`/sales/columns/${id}`, { method: "DELETE" }),
  salesRecords: (f?: { user_id?: number; date_from?: string; date_to?: string; limit?: number; offset?: number }) => {
    const p = new URLSearchParams();
    if (f?.user_id) p.set("user_id", String(f.user_id));
    if (f?.date_from) p.set("date_from", f.date_from);
    if (f?.date_to) p.set("date_to", f.date_to);
    if (f?.limit) p.set("limit", String(f.limit));
    if (f?.offset) p.set("offset", String(f.offset));
    const qs = p.toString();
    return request<SalesRecord[]>(`/sales/records${qs ? "?" + qs : ""}`);
  },
  createSalesRecord: (data: any) => request<SalesRecord>("/sales/records", { method: "POST", body: JSON.stringify(data) }),
  updateSalesRecord: (id: number, data: any) => request<SalesRecord>(`/sales/records/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteSalesRecord: (id: number) => request<void>(`/sales/records/${id}`, { method: "DELETE" }),

  // marketing
  marketingColumns: () => request<ColumnDef[]>("/marketing/columns"),
  addMarketingColumn: (data: { label: string; kind?: string }) => request<ColumnDef>("/marketing/columns", { method: "POST", body: JSON.stringify(data) }),
  deleteMarketingColumn: (id: number) => request<void>(`/marketing/columns/${id}`, { method: "DELETE" }),
  marketingRecords: (f?: { date_from?: string; date_to?: string }) => {
    const p = new URLSearchParams();
    if (f?.date_from) p.set("date_from", f.date_from);
    if (f?.date_to) p.set("date_to", f.date_to);
    const qs = p.toString();
    return request<MarketingRecord[]>(`/marketing/records${qs ? "?" + qs : ""}`);
  },
  createMarketingRecord: (data: any) => request<MarketingRecord>("/marketing/records", { method: "POST", body: JSON.stringify(data) }),
  updateMarketingRecord: (id: number, data: any) => request<MarketingRecord>(`/marketing/records/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteMarketingRecord: (id: number) => request<void>(`/marketing/records/${id}`, { method: "DELETE" }),

  // ad expenses
  adExpenses: (f?: { source_id?: number; date_from?: string; date_to?: string; campaign?: string; skip?: number; limit?: number }) => {
    const p = new URLSearchParams();
    if (f?.source_id) p.set("source_id", String(f.source_id));
    if (f?.date_from) p.set("date_from", f.date_from);
    if (f?.date_to) p.set("date_to", f.date_to);
    if (f?.campaign) p.set("campaign", f.campaign);
    if (f?.skip) p.set("skip", String(f.skip));
    if (f?.limit) p.set("limit", String(f.limit));
    const qs = p.toString();
    return request<{ items: import("./types").AdExpense[]; total: number }>(`/marketing/ad-expenses${qs ? "?" + qs : ""}`);
  },
  createAdExpense: (data: any) => request<import("./types").AdExpense>("/marketing/ad-expenses", { method: "POST", body: JSON.stringify(data) }),
  updateAdExpense: (id: number, data: any) => request<import("./types").AdExpense>(`/marketing/ad-expenses/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteAdExpense: (id: number) => request<void>(`/marketing/ad-expenses/${id}`, { method: "DELETE" }),
  marketingMetrics: (f?: { date_from?: string; date_to?: string }) => {
    const p = new URLSearchParams();
    if (f?.date_from) p.set("date_from", f.date_from);
    if (f?.date_to) p.set("date_to", f.date_to);
    const qs = p.toString();
    return request<import("./types").MarketingMetrics>(`/marketing/metrics${qs ? "?" + qs : ""}`);
  },

  // sales column reorder
  reorderSalesColumn: (id: number, direction: "left" | "right") =>
    request<any>(`/sales/columns/${id}/position?direction=${direction}`, { method: "PATCH" }),

  // kanban column reorder
  reorderColumn: (colId: number, newPosition: number) =>
    request<BoardColumn>(`/boards/columns/${colId}/position?new_position=${newPosition}`, { method: "PATCH" }),
};

/** Public links never send the employee JWT and never redirect to /login. */
export async function getPublicBoard(token: string): Promise<PublicBoard> {
  const res = await fetch("/api/public/boards/view", {
    cache: "no-store",
    headers: { "X-Board-Share-Token": token },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Ссылка недействительна" }));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  return res.json();
}

// search
export const searchApi = {
  search: (q: string) => request<{ users: any[]; projects: any[]; tasks: any[] }>(`/search?q=${encodeURIComponent(q)}`),
};

// notifications
export const notifApi = {
  get: () => request<{ count: number; items: any[] }>("/notifications"),
};

// bug reports
export const bugApi = {
  list: (status?: string) => {
    const qs = status ? `?status=${status}` : "";
    return request<import("./types").BugReport[]>(`/bugs${qs}`);
  },
  countNew: () => request<{ count: number }>("/bugs/count/new"),
  create: (data: { title: string; description?: string; priority?: string }) =>
    request<import("./types").BugReport>("/bugs", { method: "POST", body: JSON.stringify(data) }),
  update: (id: number, data: any) =>
    request<import("./types").BugReport>(`/bugs/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  delete: (id: number) => request<void>(`/bugs/${id}`, { method: "DELETE" }),
};

// settings / CRM lookups
export const settingsApi = {
  // Sources
  listSources: () => request<import("./types").LeadSource[]>("/settings/sources"),
  createSource: (name: string) => request<import("./types").LeadSource>("/settings/sources", { method: "POST", body: JSON.stringify({ name }) }),
  updateSource: (id: number, data: any) => request<import("./types").LeadSource>(`/settings/sources/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  reorderSource: (id: number, position: number) => request<import("./types").LeadSource[]>(`/settings/sources/${id}/reorder?new_position=${position}`, { method: "POST" }),

  // Services
  listServices: () => request<import("./types").ServiceItem[]>("/settings/services"),
  createService: (name: string) => request<import("./types").ServiceItem>("/settings/services", { method: "POST", body: JSON.stringify({ name }) }),
  updateService: (id: number, data: any) => request<import("./types").ServiceItem>(`/settings/services/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  reorderService: (id: number, position: number) => request<import("./types").ServiceItem[]>(`/settings/services/${id}/reorder?new_position=${position}`, { method: "POST" }),

  // Stages — archived ones are excluded unless explicitly requested
  listStages: (includeArchived = false, withCounts = false) => {
    const params = [includeArchived && "include_archived=true", withCounts && "with_counts=true"].filter(Boolean);
    return request<import("./types").LeadStage[]>(`/settings/stages${params.length ? `?${params.join("&")}` : ""}`);
  },
  archiveStage: (id: number) =>
    request<import("./types").LeadStage>(`/settings/stages/${id}/archive`, { method: "POST" }),
  createStage: (data: any) => request<import("./types").LeadStage>("/settings/stages", { method: "POST", body: JSON.stringify(data) }),
  updateStage: (id: number, data: any) => request<import("./types").LeadStage>(`/settings/stages/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  reorderStage: (id: number, position: number) => request<import("./types").LeadStage[]>(`/settings/stages/${id}/reorder?new_position=${position}`, { method: "POST" }),

  // Reject reasons
  listRejectReasons: () => request<import("./types").RejectReason[]>("/settings/reject-reasons"),
  createRejectReason: (name: string) => request<import("./types").RejectReason>("/settings/reject-reasons", { method: "POST", body: JSON.stringify({ name }) }),
  updateRejectReason: (id: number, data: any) => request<import("./types").RejectReason>(`/settings/reject-reasons/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  reorderRejectReason: (id: number, position: number) => request<import("./types").RejectReason[]>(`/settings/reject-reasons/${id}/reorder?new_position=${position}`, { method: "POST" }),

  // Expense categories
  listExpenseCategories: () => request<import("./types").ExpenseCategory[]>("/settings/expense-categories"),
  createExpenseCategory: (name: string) => request<import("./types").ExpenseCategory>("/settings/expense-categories", { method: "POST", body: JSON.stringify({ name }) }),
  updateExpenseCategory: (id: number, data: any) => request<import("./types").ExpenseCategory>(`/settings/expense-categories/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  reorderExpenseCategory: (id: number, position: number) => request<import("./types").ExpenseCategory[]>(`/settings/expense-categories/${id}/reorder?new_position=${position}`, { method: "POST" }),

  // Accounts
  listAccounts: () => request<import("./types").Account[]>("/settings/accounts"),
  createAccount: (data: { name: string; currency?: string }) => request<import("./types").Account>("/settings/accounts", { method: "POST", body: JSON.stringify(data) }),
  updateAccount: (id: number, data: any) => request<import("./types").Account>(`/settings/accounts/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  reorderAccount: (id: number, position: number) => request<import("./types").Account[]>(`/settings/accounts/${id}/reorder?new_position=${position}`, { method: "POST" }),
};

// leads
/** Filters shared by the list and funnel views of «Лиды и воронка». */
export interface LeadQuery {
  source_id?: number | string; service_id?: number | string;
  setter_id?: number | string; closer_id?: number | string;
  stage_id?: number | string; status?: string;
  date_from?: string; date_to?: string; search?: string;
  /** Only leads a meeting can still be booked for: not archived, not won/lost. */
  open_only?: boolean;
  limit?: number; offset?: number;
}

/** Board filters: the list filters plus the board's quick toggles. */
export interface BoardQuery extends LeadQuery {
  mine?: boolean; unassigned?: boolean; show_closed?: boolean; overdue?: boolean; no_task?: boolean;
}

function leadQueryString(f?: LeadQuery): string {
  const p = new URLSearchParams();
  for (const key of [
    "source_id", "service_id", "setter_id", "closer_id", "stage_id",
    "status", "date_from", "date_to", "search",
  ] as const) {
    const v = f?.[key];
    if (v !== undefined && v !== null && v !== "") p.set(key, String(v));
  }
  if (f?.open_only) p.set("open_only", "true");
  if (f?.limit !== undefined) p.set("limit", String(f.limit));
  if (f?.offset) p.set("offset", String(f.offset));
  const qs = p.toString();
  return qs ? "?" + qs : "";
}

/** List filters + board toggles. Uses toString(), not `.size` (missing in Safari < 17). */
export function boardQueryString(query?: BoardQuery): string {
  const p = new URLSearchParams(leadQueryString(query).replace(/^\?/, ""));
  for (const key of ["mine", "unassigned", "show_closed", "overdue", "no_task"] as const) if (query?.[key]) p.set(key, "true");
  const qs = p.toString();
  return qs ? "?" + qs : "";
}

/** List query: like the board's, but `show_closed=false` is sent explicitly (the list shows closed leads by default). */
export function listQueryString(query?: BoardQuery): string {
  const p = new URLSearchParams(boardQueryString(query).replace(/^\?/, ""));
  if (query?.show_closed === false) p.set("show_closed", "false");
  const qs = p.toString();
  return qs ? "?" + qs : "";
}

export const leadBoardApi = {
  get: (query?: BoardQuery) => request<import("./types").LeadBoardData>(`/lead-board${boardQueryString(query)}`),
};

export const leadApi = {
  list: (f?: BoardQuery) =>
    request<import("./types").LeadListResponse>(`/leads${listQueryString(f)}`),
  get: (id: number) => request<import("./types").LeadDetail>(`/leads/${id}`),
  create: (data: any) => request<import("./types").Lead>("/leads", { method: "POST", body: JSON.stringify(data) }),
  update: (id: number, data: any) => request<import("./types").Lead>(`/leads/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  findDuplicate: (phone: string, excludeId?: number) => {
    const p = new URLSearchParams({ phone });
    if (excludeId != null) p.set("exclude_id", String(excludeId));
    return request<{ existing: import("./apiError").ExistingLead | null }>(`/leads/duplicates?${p}`);
  },
  archive: (id: number) => request<import("./types").Lead>(`/leads/${id}/archive`, { method: "POST" }),
  changeStage: (id: number, to_stage_id: number, comment = "", extra_data: Record<string, any> = {}) =>
    request<import("./types").Lead>(`/leads/${id}/stage`, { method: "PATCH", body: JSON.stringify({ to_stage_id, comment, extra_data }) }),
  // Funnel accepts the same filter set as the list — the two views never diverge.
  funnel: (f?: LeadQuery) =>
    request<import("./types").FunnelResponse>(`/leads/funnel${leadQueryString(f)}`),
  addActivity: (id: number, data: { activity_type: string; channel?: string; description?: string; responsible_id?: number }) =>
    request<import("./types").LeadActivity>(`/leads/${id}/activities`, { method: "POST", body: JSON.stringify(data) }),
  addFile: (id: number, data: { name: string; url: string; file_type?: string }) =>
    request<import("./types").LeadFile>(`/leads/${id}/files`, { method: "POST", body: JSON.stringify(data) }),
  deleteFile: (leadId: number, fileId: number) =>
    request<void>(`/leads/${leadId}/files/${fileId}`, { method: "DELETE" }),

  // ── Payment schedule ──
  payments: (leadId: number) =>
    request<import("./types").PaymentSchedule>(`/leads/${leadId}/payments`),
  createPayment: (leadId: number, data: {
    planned_date: string; planned_amount: number;
    payment_method?: string; account_id?: number | null; comment?: string;
  }) => request<import("./types").PaymentSchedule>(`/leads/${leadId}/payments`, {
    method: "POST", body: JSON.stringify(data),
  }),
  updatePayment: (leadId: number, paymentId: number, data: {
    planned_date?: string; planned_amount?: number; payment_method?: string;
    account_id?: number | null; comment?: string; cancelled?: boolean;
  }) => request<import("./types").PaymentSchedule>(`/leads/${leadId}/payments/${paymentId}`, {
    method: "PATCH", body: JSON.stringify(data),
  }),
  /** «Зафиксировать оплату» — records the amount actually received. */
  confirmPayment: (leadId: number, paymentId: number, data: {
    amount: number; paid_date?: string; payment_method?: string;
    account_id?: number | null; comment?: string;
  }) => request<import("./types").PaymentSchedule>(
    `/leads/${leadId}/payments/${paymentId}/confirm`,
    { method: "POST", body: JSON.stringify(data) },
  ),
  deletePayment: (leadId: number, paymentId: number) =>
    request<import("./types").PaymentSchedule>(`/leads/${leadId}/payments/${paymentId}`, {
      method: "DELETE",
    }),
};

// unified personal calendar
export const calendarApi = {
  get: (f?: { user_id?: number; date_from?: string; date_to?: string }) => {
    const p = new URLSearchParams();
    if (f?.user_id) p.set("user_id", String(f.user_id));
    if (f?.date_from) p.set("date_from", f.date_from);
    if (f?.date_to) p.set("date_to", f.date_to);
    const qs = p.toString();
    return request<import("./types").CalendarResponse>(`/calendar${qs ? "?" + qs : ""}`);
  },
};


// finance
export const financeApi = {
  transactions: (f?: { type?: string; category?: string; date_from?: string; date_to?: string; account_id?: number; skip?: number; limit?: number }) => {
    const p = new URLSearchParams();
    if (f?.type) p.set("type", f.type);
    if (f?.category) p.set("category", f.category);
    if (f?.date_from) p.set("date_from", f.date_from);
    if (f?.date_to) p.set("date_to", f.date_to);
    if (f?.account_id) p.set("account_id", String(f.account_id));
    if (f?.skip) p.set("skip", String(f.skip));
    if (f?.limit) p.set("limit", String(f.limit));
    const qs = p.toString();
    return request<{ items: import("./types").FinanceTransaction[]; total: number }>(`/finance/transactions${qs ? "?" + qs : ""}`);
  },
  createTransaction: (data: any) => request<import("./types").FinanceTransaction>("/finance/transactions", { method: "POST", body: JSON.stringify(data) }),
  updateTransaction: (id: number, data: any) => request<import("./types").FinanceTransaction>(`/finance/transactions/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteTransaction: (id: number) => request<void>(`/finance/transactions/${id}`, { method: "DELETE" }),
  debts: () => request<import("./types").Debt[]>("/finance/debts"),
  createDebt: (data: any) => request<import("./types").Debt>("/finance/debts", { method: "POST", body: JSON.stringify(data) }),
  updateDebt: (id: number, data: any) => request<import("./types").Debt>(`/finance/debts/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteDebt: (id: number) => request<void>(`/finance/debts/${id}`, { method: "DELETE" }),
  balances: () => request<import("./types").AccountBalance[]>("/finance/balances"),
  createBalance: (data: any) => request<import("./types").AccountBalance>("/finance/balances", { method: "POST", body: JSON.stringify(data) }),
  updateBalance: (id: number, data: any) => request<import("./types").AccountBalance>(`/finance/balances/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteBalance: (id: number) => request<void>(`/finance/balances/${id}`, { method: "DELETE" }),
  summary: (f?: { date_from?: string; date_to?: string }) => {
    const p = new URLSearchParams();
    if (f?.date_from) p.set("date_from", f.date_from);
    if (f?.date_to) p.set("date_to", f.date_to);
    const qs = p.toString();
    return request<import("./types").FinanceSummary>(`/finance/summary${qs ? "?" + qs : ""}`);
  },
};

// payroll
export const payrollApi = {
  rules: (employee_id?: number) => {
    const qs = employee_id ? `?employee_id=${employee_id}` : "";
    return request<import("./types").PayrollRule[]>(`/payroll/rules${qs}`);
  },
  createRule: (data: any) => request<import("./types").PayrollRule>("/payroll/rules", { method: "POST", body: JSON.stringify(data) }),
  updateRule: (id: number, data: any) => request<import("./types").PayrollRule>(`/payroll/rules/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteRule: (id: number) => request<void>(`/payroll/rules/${id}`, { method: "DELETE" }),
  calculate: (period_start: string, period_end: string, employee_id?: number) => {
    const p = new URLSearchParams({ period_start, period_end });
    if (employee_id) p.set("employee_id", String(employee_id));
    return request<import("./types").PayrollCalculation | import("./types").PayrollCalculation[]>(`/payroll/calculate?${p.toString()}`);
  },
  commit: (data: { employee_id: number; period_start: string; period_end: string }) =>
    request<import("./types").PayrollRecord>("/payroll/commit", { method: "POST", body: JSON.stringify(data) }),
  records: (employee_id?: number) => {
    const qs = employee_id ? `?employee_id=${employee_id}` : "";
    return request<import("./types").PayrollRecord[]>(`/payroll/records${qs}`);
  },
  updateRecordStatus: (id: number, status: string) =>
    request<import("./types").PayrollRecord>(`/payroll/records/${id}/status?status=${status}`, { method: "PUT" }),
};

// analytics
export const analyticsApi = {
  dashboard: (date_from?: string, date_to?: string) => {
    const p = new URLSearchParams();
    if (date_from) p.set("date_from", date_from);
    if (date_to) p.set("date_to", date_to);
    const qs = p.toString();
    return request<{ metrics: import("./types").DashboardMetrics; charts: import("./types").ChartsData; problems: import("./types").Problem[] }>(`/analytics/dashboard${qs ? "?" + qs : ""}`);
  },
  kpi: (year: number, month: number) =>
    request<import("./types").KpiPlanFact>(`/analytics/kpi?year=${year}&month=${month}`),
  listPlans: () => request<import("./types").MonthlyPlan[]>("/analytics/plans"),
  createPlan: (data: Omit<import("./types").MonthlyPlan, "id">) =>
    request<import("./types").MonthlyPlan>("/analytics/plans", { method: "POST", body: JSON.stringify(data) }),
  updatePlan: (id: number, data: Omit<import("./types").MonthlyPlan, "id">) =>
    request<import("./types").MonthlyPlan>(`/analytics/plans/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deletePlan: (id: number) => request<void>(`/analytics/plans/${id}`, { method: "DELETE" }),
  exportXlsx: async (type: "leads" | "finance" | "payroll", params?: Record<string, string>) => {
    const token = getToken();
    const p = new URLSearchParams(params);
    const res = await fetch(`/api/analytics/export/${type}.xlsx?${p.toString()}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error("Ошибка экспорта");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${type}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  },
};

// dev payroll config
export const devPayrollConfigApi = {
  list: () => request<import("./types").DevPayrollConfig[]>("/payroll/dev-config"),
  update: (id: number, data: { new_bot_price: number; support_price: number; base_salary: number; free_bots_limit: number }) =>
    request<import("./types").DevPayrollConfig>(`/payroll/dev-config/${id}`, { method: "PUT", body: JSON.stringify(data) }),
};

// meetings
export const meetingApi = {
  list: (f?: { closer_id?: number; setter_id?: number; status?: string; year?: number; month?: number; date_from?: string; date_to?: string; offset?: number; limit?: number; parent_only?: boolean }) => {
    const p = new URLSearchParams();
    if (f?.closer_id) p.set("closer_id", String(f.closer_id));
    if (f?.setter_id) p.set("setter_id", String(f.setter_id));
    if (f?.status) p.set("status", f.status);
    if (f?.parent_only === false) p.set("parent_only", "false");
    if (f?.year)   p.set("year",   String(f.year));
    if (f?.month)  p.set("month",  String(f.month));
    if (f?.date_from) p.set("date_from", f.date_from);
    if (f?.date_to)   p.set("date_to",   f.date_to);
    if (f?.offset) p.set("offset", String(f.offset));
    if (f?.limit)  p.set("limit",  String(f.limit));
    const qs = p.toString();
    return request<import("./types").Meeting[]>(`/meetings${qs ? "?" + qs : ""}`);
  },
  get: (id: number) => request<import("./types").Meeting>(`/meetings/${id}`),
  create: (data: { setter_id?: number | null; [k: string]: any }) => request<import("./types").Meeting>("/meetings", { method: "POST", body: JSON.stringify(data) }),
  update: (id: number, data: any) => request<import("./types").Meeting>(`/meetings/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  setStatus: (id: number, status: string) => request<import("./types").Meeting>(`/meetings/${id}/status?status=${status}`, { method: "PATCH" }),
  delete: (id: number) => request<void>(`/meetings/${id}`, { method: "DELETE" }),
};

// API key management
export const apiKeys = {
  list: () => request<import("./types").ApiKey[]>("/api-keys"),
  create: (name: string) => request<import("./types").ApiKeyCreated>("/api-keys", { method: "POST", body: JSON.stringify({ name }) }),
  revoke: (id: number) => request<void>(`/api-keys/${id}`, { method: "DELETE" }),
};

// Espada Labs lab projects
export const labProjectApi = {
  list: (include_archived = false) =>
    request<import("./types").LabProject[]>(`/lab-projects${include_archived ? "?include_archived=true" : ""}`),
  get: (id: number) => request<import("./types").LabProject>(`/lab-projects/${id}`),
  create: (data: { name: string; description?: string; status?: string; member_ids?: number[] }) =>
    request<import("./types").LabProject>("/lab-projects", { method: "POST", body: JSON.stringify(data) }),
  update: (id: number, data: { name?: string; description?: string; status?: string; member_ids?: number[] }) =>
    request<import("./types").LabProject>(`/lab-projects/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  archive: (id: number) =>
    request<import("./types").LabProject>(`/lab-projects/${id}/archive`, { method: "POST" }),
  addMember: (id: number, user_id: number) =>
    request<import("./types").LabProject>(`/lab-projects/${id}/members`, { method: "POST", body: JSON.stringify({ user_id }) }),
  removeMember: (id: number, user_id: number) =>
    request<import("./types").LabProject>(`/lab-projects/${id}/members/${user_id}`, { method: "DELETE" }),
};


// ── WhatsApp ───────────────────────────────────────────────────
async function whatsappForm<T>(path: string, form: FormData): Promise<T> {
  const token = getToken();
  const res = await fetch(`/api${path}`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Ошибка отправки" }));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  return res.json();
}

export const salesHubApi = {
  today: () => request<import("./types").SalesToday>("/sales-hub/today"),
  metrics: (q: import("./types").SalesMetricsQuery) => {
    const p = new URLSearchParams({ date_from: q.date_from, date_to: q.date_to });
    if (q.source_id) p.set("source_id", String(q.source_id));
    if (q.service_id) p.set("service_id", String(q.service_id));
    if (q.user_id) p.set("user_id", String(q.user_id));
    return request<import("./types").SalesMetrics>(`/sales-hub/metrics?${p.toString()}`);
  },
};

export const telegramApi = {
  get: () => request<import("./types").TelegramSettings>("/sales-hub/telegram"),
  saveToken: (token: string) =>
    request<import("./types").TelegramSettings>("/sales-hub/telegram/token", { method: "PUT", body: JSON.stringify({ token }) }),
  findGroups: () => request<import("./types").TelegramGroup[]>("/sales-hub/telegram/groups", { method: "POST" }),
  update: (patch: { enabled?: boolean; chat_id?: string; chat_title?: string }) =>
    request<import("./types").TelegramSettings>("/sales-hub/telegram", { method: "PUT", body: JSON.stringify(patch) }),
  sendTest: () => request<{ ok: boolean }>("/sales-hub/telegram/test", { method: "POST" }),
  saveCloser: (userId: number, telegram_username: string) =>
    request<{ id: number; telegram_username: string }>(`/sales-hub/telegram/closers/${userId}`, { method: "PUT", body: JSON.stringify({ telegram_username }) }),
};

export const whatsappApi = {
  access: () => request<{ can_use: boolean }>("/whatsapp/access"),
  status: () => request<import("./types").WhatsAppStatus>("/whatsapp/status"),
  connect: () => request<import("./types").WhatsAppConnect>("/whatsapp/connect", { method: "POST" }),
  logout: () => request<{ state: string }>("/whatsapp/logout", { method: "POST" }),
  messages: (leadId: number, afterId?: number) =>
    request<import("./types").WhatsAppThread>(`/whatsapp/leads/${leadId}/messages${afterId ? `?after_id=${afterId}` : ""}`),
  sendText: (leadId: number, text: string) =>
    request<import("./types").WhatsAppMessage>(`/whatsapp/leads/${leadId}/messages`, { method: "POST", body: JSON.stringify({ text }) }),
  sendMedia: (leadId: number, file: File, caption: string) => {
    const form = new FormData();
    form.append("file", file);
    form.append("caption", caption);
    return whatsappForm<import("./types").WhatsAppMessage>(`/whatsapp/leads/${leadId}/media`, form);
  },
  /** Client file as an object URL (auth header required, so no plain <img src>). Caller revokes it. */
  mediaUrl: async (messageId: number): Promise<string> => {
    const token = getToken();
    const res = await fetch(`/api/whatsapp/media/${messageId}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!res.ok) throw new Error("Файл недоступен");
    const blob = await res.blob();
    // Re-type anything that is not a safe raster image so the browser never renders it.
    const { isInlineImage } = await import("./whatsapp");
    const safe = isInlineImage(blob.type) ? blob : new Blob([blob], { type: "application/octet-stream" });
    return URL.createObjectURL(safe);
  },
  take: (leadId: number) => request<{ lead_id: number; setter_id: number }>(`/whatsapp/leads/${leadId}/take`, { method: "POST" }),
  ignore: (chatId: number) => request<import("./types").WhatsAppChat>(`/whatsapp/chats/${chatId}/ignore`, { method: "POST" }),
  unignore: (chatId: number) => request<import("./types").WhatsAppChat>(`/whatsapp/chats/${chatId}/unignore`, { method: "POST" }),
  makeLead: (chatId: number) => request<import("./types").WhatsAppChat>(`/whatsapp/chats/${chatId}/make-lead`, { method: "POST" }),
  otherChats: () => request<import("./types").WhatsAppChat[]>("/whatsapp/chats/other"),
};


// ── Lead tasks & feed ──────────────────────────────────────────
export const leadTasksApi = {
  list: (leadId: number, status: "open" | "all" = "open") =>
    request<import("./types").LeadTask[]>(`/leads/${leadId}/tasks?status=${status}`),
  create: (leadId: number, body: { kind: import("./types").LeadTaskKind; due_at: string; assignee_id?: number | null; comment?: string }) =>
    request<import("./types").LeadTask>(`/leads/${leadId}/tasks`, { method: "POST", body: JSON.stringify(body) }),
  complete: (id: number, result: "connected" | "no_answer" | "done", note = "") =>
    request<import("./types").CompleteResult>(`/lead-tasks/${id}/complete`, { method: "POST", body: JSON.stringify({ result, note }) }),
  reschedule: (id: number, dueAt: string) =>
    request<import("./types").LeadTask>(`/lead-tasks/${id}/reschedule`, { method: "POST", body: JSON.stringify({ due_at: dueAt }) }),
  cancel: (id: number) => request<import("./types").LeadTask>(`/lead-tasks/${id}/cancel`, { method: "POST" }),
  assign: (id: number, assigneeId: number) =>
    request<import("./types").LeadTask>(`/lead-tasks/${id}/assign`, { method: "POST", body: JSON.stringify({ assignee_id: assigneeId }) }),
  mine: (scope: "overdue" | "today" | "upcoming" | "all" = "all", assignee: string = "me") =>
    request<import("./types").LeadTask[]>(`/lead-tasks?scope=${scope}&assignee=${encodeURIComponent(assignee)}`),
};

export const leadFeedApi = {
  page: (leadId: number, before?: string | null, limit = 50) =>
    request<import("./types").FeedPage>(`/leads/${leadId}/feed?limit=${limit}${before ? `&before=${encodeURIComponent(before)}` : ""}`),
  addNote: (leadId: number, text: string) =>
    request<unknown>(`/leads/${leadId}/activities`, { method: "POST", body: JSON.stringify({ activity_type: "note", description: text }) }),
};
