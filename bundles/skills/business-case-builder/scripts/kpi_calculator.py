#!/usr/bin/env python3
"""Compute standard business KPIs from a small JSON of raw inputs.

Formulas match references/kpi-framework.md exactly — do not duplicate the
logic elsewhere; if a formula changes, change it here and in that file
together. Writes kpi-computed.md (paste into the report) and
kpi-computed.json (read back instead of re-deriving numbers by hand — every
number in the report must trace to executed code, SKILL.md rule #2).

Missing inputs are reported, not guessed: a metric whose required inputs are
absent gets value=null and a note explaining what is missing, rather than a
fabricated number.

Usage:
    python kpi_calculator.py INPUTS.json [--out DIR]

Input JSON fields (all optional; a metric computes only if its inputs are present):
    revenue_monthly, revenue_monthly_prev, cogs_monthly, marketing_sales_cost,
    new_customers, active_customers, churned_customers, cash_on_hand,
    fixed_costs_monthly, price_per_unit, variable_cost_per_unit,
    value_start, value_end, years, burn_rate_monthly
"""

import argparse
import json
from pathlib import Path


def get(d, *keys):
    """Return the values for `keys`, or None if any is missing/non-numeric."""
    values = []
    for k in keys:
        v = d.get(k)
        if v is None or not isinstance(v, (int, float)):
            return None
        values.append(v)
    return values


def metric(key, label, formula, value, note=None):
    return {"key": key, "label": label, "formula": formula, "value": value, "note": note}


def compute(d: dict) -> list:
    metrics = []

    # --- Growth / Revenue ---
    mrr = get(d, "revenue_monthly")
    metrics.append(metric("mrr", "MRR", "revenue_monthly", mrr[0] if mrr else None,
                           None if mrr else "thiếu revenue_monthly"))
    arr = mrr[0] * 12 if mrr else None
    metrics.append(metric("arr", "ARR", "MRR × 12", arr,
                           None if arr is not None else "thiếu revenue_monthly"))

    mom = get(d, "revenue_monthly", "revenue_monthly_prev")
    mom_rate = None
    if mom and mom[1] != 0:
        mom_rate = (mom[0] - mom[1]) / mom[1]
    metrics.append(metric("mom_growth_rate", "MoM growth rate",
                           "(revenue_monthly − revenue_monthly_prev) ÷ revenue_monthly_prev", mom_rate,
                           None if mom_rate is not None else "thiếu revenue_monthly/revenue_monthly_prev"))

    cagr_inputs = get(d, "value_start", "value_end", "years")
    cagr = None
    if cagr_inputs and cagr_inputs[0] > 0 and cagr_inputs[2] > 0:
        cagr = (cagr_inputs[1] / cagr_inputs[0]) ** (1 / cagr_inputs[2]) - 1
    metrics.append(metric("cagr", "CAGR", "(value_end ÷ value_start)^(1 ÷ years) − 1", cagr,
                           None if cagr is not None else "thiếu value_start/value_end/years"))

    # --- Financial / unit economics ---
    margin_inputs = get(d, "revenue_monthly", "cogs_monthly")
    gross_margin = None
    if margin_inputs and margin_inputs[0] != 0:
        gross_margin = (margin_inputs[0] - margin_inputs[1]) / margin_inputs[0]
    metrics.append(metric("gross_margin", "Gross margin",
                           "(revenue_monthly − cogs_monthly) ÷ revenue_monthly", gross_margin,
                           None if gross_margin is not None else "thiếu revenue_monthly/cogs_monthly"))

    # --- Customer ---
    cac_inputs = get(d, "marketing_sales_cost", "new_customers")
    cac = None
    if cac_inputs and cac_inputs[1] != 0:
        cac = cac_inputs[0] / cac_inputs[1]
    metrics.append(metric("cac", "CAC", "marketing_sales_cost ÷ new_customers", cac,
                           None if cac is not None else "thiếu marketing_sales_cost/new_customers"))

    arpu_inputs = get(d, "revenue_monthly", "active_customers")
    arpu = None
    if arpu_inputs and arpu_inputs[1] != 0:
        arpu = arpu_inputs[0] / arpu_inputs[1]
    metrics.append(metric("arpu", "ARPU", "revenue_monthly ÷ active_customers", arpu,
                           None if arpu is not None else "thiếu revenue_monthly/active_customers"))

    churn_inputs = get(d, "churned_customers", "active_customers")
    churn_rate = None
    if churn_inputs and churn_inputs[1] != 0:
        churn_rate = churn_inputs[0] / churn_inputs[1]
    metrics.append(metric("churn_rate", "Churn rate", "churned_customers ÷ active_customers", churn_rate,
                           None if churn_rate is not None else "thiếu churned_customers/active_customers"))

    ltv = None
    if arpu is not None and gross_margin is not None and churn_rate not in (None, 0):
        ltv = arpu * gross_margin / churn_rate
    metrics.append(metric("ltv", "LTV", "ARPU × gross margin % ÷ churn rate", ltv,
                           None if ltv is not None else "thiếu ARPU/gross margin/churn rate (hoặc churn rate = 0)"))

    ltv_cac = None
    if ltv is not None and cac not in (None, 0):
        ltv_cac = ltv / cac
    metrics.append(metric("ltv_cac", "LTV:CAC ratio", "LTV ÷ CAC", ltv_cac,
                           None if ltv_cac is not None else "thiếu LTV/CAC"))

    cac_payback = None
    if cac is not None and arpu is not None and gross_margin not in (None, 0):
        cac_payback = cac / (arpu * gross_margin)
    metrics.append(metric("cac_payback_months", "CAC payback period (tháng)",
                           "CAC ÷ (ARPU × gross margin %)", cac_payback,
                           None if cac_payback is not None else "thiếu CAC/ARPU/gross margin"))

    # --- Burn rate / runway ---
    burn_rate = d.get("burn_rate_monthly")
    if burn_rate is None:
        cost_inputs = get(d, "fixed_costs_monthly", "marketing_sales_cost", "cogs_monthly", "revenue_monthly")
        if cost_inputs:
            fixed, mkt, cogs, rev = cost_inputs
            computed_burn = fixed + mkt + cogs - rev
            burn_rate = computed_burn if computed_burn > 0 else 0
    metrics.append(metric("burn_rate_monthly", "Burn rate (tháng)",
                           "burn_rate_monthly (nếu có) hoặc fixed+marketing+cogs − revenue", burn_rate,
                           None if burn_rate is not None else
                           "thiếu burn_rate_monthly hoặc (fixed_costs_monthly/marketing_sales_cost/cogs_monthly/revenue_monthly)"))

    runway = None
    cash = d.get("cash_on_hand")
    if cash is not None and burn_rate not in (None, 0):
        runway = cash / burn_rate
    metrics.append(metric("runway_months", "Runway (tháng)", "cash_on_hand ÷ burn_rate_monthly", runway,
                           None if runway is not None else "thiếu cash_on_hand/burn_rate_monthly (hoặc burn rate = 0, tức chưa cần runway)"))

    # --- Break-even ---
    be_inputs = get(d, "fixed_costs_monthly", "price_per_unit", "variable_cost_per_unit")
    break_even = None
    if be_inputs and (be_inputs[1] - be_inputs[2]) > 0:
        break_even = be_inputs[0] / (be_inputs[1] - be_inputs[2])
    metrics.append(metric("break_even_units", "Break-even point (đơn vị)",
                           "fixed_costs_monthly ÷ (price_per_unit − variable_cost_per_unit)", break_even,
                           None if break_even is not None else "thiếu fixed_costs_monthly/price_per_unit/variable_cost_per_unit"))

    return metrics


def to_markdown(metrics: list) -> str:
    lines = ["# KPI đã tính (scripts/kpi_calculator.py)", "",
             "| KPI | Công thức | Giá trị | Ghi chú |", "|---|---|---|---|"]
    for m in metrics:
        value = "—" if m["value"] is None else (
            f"{m['value']:.2%}" if m["key"] in ("mom_growth_rate", "cagr", "gross_margin", "churn_rate")
            else f"{m['value']:,.2f}"
        )
        note = m["note"] or ""
        lines.append(f"| {m['label']} | {m['formula']} | {value} | {note} |")
    lines += ["", "Dán bảng này vào mục \"Khung KPI\" của "
              "`templates/business-scenario-report.md` — không tự nhẩm lại số, "
              "dùng đúng giá trị đã tính ở đây (SKILL.md, Nguyên tắc bắt buộc #2)."]
    return "\n".join(lines) + "\n"


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("inputs", type=Path)
    ap.add_argument("--out", type=Path, default=Path("."))
    args = ap.parse_args()

    data = json.loads(args.inputs.read_text())
    metrics = compute(data)

    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "kpi-computed.md").write_text(to_markdown(metrics))
    (args.out / "kpi-computed.json").write_text(json.dumps({"metrics": metrics}, indent=2))

    computed = sum(1 for m in metrics if m["value"] is not None)
    print(f"Computed {computed}/{len(metrics)} KPI(s) from {args.inputs.name}")
    print(f"Reports: {args.out / 'kpi-computed.md'} , {args.out / 'kpi-computed.json'}")
    missing = [m["label"] for m in metrics if m["value"] is None]
    if missing:
        print(f"\n{len(missing)} KPI chưa tính được (thiếu input):")
        for label in missing:
            print(f"  - {label}")


if __name__ == "__main__":
    main()
