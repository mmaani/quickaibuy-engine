import { headers } from "next/headers";
import { NextResponse } from "next/server";
import {
  customerGeoSummaryDataset,
  customerMasterDataset,
  customerOrderFactsDataset,
} from "@/lib/customers/admin";
import {
  isAuthorizedReviewAuthorizationHeader,
  isReviewConsoleConfigured,
} from "@/lib/review/auth";

type ExportDataset = "master" | "facts" | "geo";
type ExportFormat = "csv" | "excel";

function escapeCsv(value: unknown): string {
  if (value == null) return "";
  const stringified = String(value);
  if (/[",\n]/.test(stringified)) {
    return `"${stringified.replace(/"/g, '""')}"`;
  }
  return stringified;
}

function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const columns = Object.keys(rows[0]);
  const head = columns.join(",");
  const body = rows.map((row) => columns.map((c) => escapeCsv(row[c])).join(",")).join("\n");
  return `${head}\n${body}`;
}

function toExcelXml(rows: Record<string, unknown>[]): string {
  const columns = rows.length ? Object.keys(rows[0]) : [];
  const cell = (value: unknown) => {
    const safe = String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    return `<Cell><Data ss:Type=\"String\">${safe}</Data></Cell>`;
  };

  const header = `<Row>${columns.map((c) => cell(c)).join("")}</Row>`;
  const dataRows = rows
    .map((row) => `<Row>${columns.map((c) => cell(row[c])).join("")}</Row>`)
    .join("");

  return `<?xml version="1.0"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Worksheet ss:Name="customers">
  <Table>${header}${dataRows}</Table>
 </Worksheet>
</Workbook>`;
}

async function loadDataset(dataset: ExportDataset): Promise<Record<string, unknown>[]> {
  if (dataset === "facts") return await customerOrderFactsDataset();
  if (dataset === "geo") return await customerGeoSummaryDataset();
  return await customerMasterDataset();
}

export async function GET(request: Request) {
  const auth = (await headers()).get("authorization");
  if (!isReviewConsoleConfigured() || !isAuthorizedReviewAuthorizationHeader(auth)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const dataset = (url.searchParams.get("dataset") ?? "master") as ExportDataset;
  const format = (url.searchParams.get("format") ?? "csv") as ExportFormat;

  if (!["master", "facts", "geo"].includes(dataset)) {
    return NextResponse.json({ ok: false, error: "invalid_dataset" }, { status: 400 });
  }
  if (!["csv", "excel"].includes(format)) {
    return NextResponse.json({ ok: false, error: "invalid_format" }, { status: 400 });
  }

  const rows = await loadDataset(dataset);
  const now = new Date().toISOString().replace(/[:.]/g, "-");
  const base = `customers_${dataset}_${now}`;

  if (format === "excel") {
    const body = toExcelXml(rows);
    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.ms-excel; charset=utf-8",
        "Content-Disposition": `attachment; filename=\"${base}.xls\"`,
      },
    });
  }

  const body = toCsv(rows);
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename=\"${base}.csv\"`,
    },
  });
}
