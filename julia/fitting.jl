
const R_GAS = 8.314e-3  # kJ/(mol·K) — ΔH, ΔCp parameters are in kJ/mol and kJ/(mol·K)

# ── Parameter layout ──────────────────────────────────────────────────────────
# Per pKa group:
#   without ΔCp: [pKa_ref, ΔH, A_dh]             (3 params)
#   with    ΔCp: [pKa_ref, ΔH, ΔCp, A_dh]        (4 params)
# Then resonance blocks (N_RES_P or N_RES_P_3S elements each).
# ΔCp term: ΔCp/R * (ln(T/T_ref) + T_ref/T - 1)
const N_RES_P    = 6   # shift params per resonance, 2-state
const N_RES_P_3S = 9   # shift params per resonance, 3-state

n_pka_params(use_ΔCp) = use_ΔCp ? 4 : 3

# ── Physics ───────────────────────────────────────────────────────────────────
davies(I) = I > 0 ? (s = sqrt(I); s / (1 + s - 0.3 * I)) : zero(I)

function calc_pKa(T, I, pKa_ref, ΔH, ΔCp, A_dh, T_ref)
    pKa_ref + ΔH / R_GAS * (1 / T_ref - 1 / T) +
    ΔCp / R_GAS * (log(T / T_ref) + T_ref / T - 1) +
    A_dh * davies(I)
end

function calc_δobs(T, I, pH, δ0p, αp, βp, δ0d, αd, βd, pKa, T_ref)
    δprot   = δ0p + αp/1000 * (T - T_ref) + βp/1000 * I
    δdeprot = δ0d + αd/1000 * (T - T_ref) + βd/1000 * I
    δprot + (δdeprot - δprot) / (1 + exp10(pKa - pH))
end

# ── Model closures ────────────────────────────────────────────────────────────
function make_2state_model(n_res, T_ref, use_ΔCp=false)
    n_pp = n_pka_params(use_ΔCp)
    (X, p) -> begin
        pKa_ref = p[1];  ΔH = p[2]
        ΔCp_v   = use_ΔCp ? p[3] : zero(eltype(p))
        A_dh    = p[use_ΔCp ? 4 : 3]
        pred = zeros(eltype(p), size(X, 1))
        for j in axes(X, 1)
            Ij, Tj, pHj = X[j, 1], X[j, 2], X[j, 3]
            r = Int(X[j, 4])
            pKa = calc_pKa(Tj, Ij, pKa_ref, ΔH, ΔCp_v, A_dh, T_ref)
            o = n_pp + (r - 1) * N_RES_P
            pred[j] = calc_δobs(Tj, Ij, pHj, p[o+1], p[o+2], p[o+3], p[o+4], p[o+5], p[o+6], pKa, T_ref)
        end
        pred
    end
end

function make_3state_model(n_res, T_ref, use_ΔCp=false)
    n_pp  = n_pka_params(use_ΔCp)
    n_tot = 2 * n_pp
    (X, p) -> begin
        pKa1_ref = p[1];        ΔH1 = p[2]
        ΔCp1_v   = use_ΔCp ? p[3] : zero(eltype(p))
        A_dh1    = p[use_ΔCp ? 4 : 3]
        pKa2_ref = p[n_pp+1];   ΔH2 = p[n_pp+2]
        ΔCp2_v   = use_ΔCp ? p[n_pp+3] : zero(eltype(p))
        A_dh2    = p[use_ΔCp ? n_pp+4 : n_pp+3]
        pred = zeros(eltype(p), size(X, 1))
        for j in axes(X, 1)
            Ij, Tj, pHj = X[j, 1], X[j, 2], X[j, 3]
            r = Int(X[j, 4])
            pKa1 = calc_pKa(Tj, Ij, pKa1_ref, ΔH1, ΔCp1_v, A_dh1, T_ref)
            pKa2 = calc_pKa(Tj, Ij, pKa2_ref, ΔH2, ΔCp2_v, A_dh2, T_ref)
            o    = n_tot + (r - 1) * N_RES_P_3S
            δ0   = p[o+1] + p[o+2]/1000 * (Tj - T_ref) + p[o+3]/1000 * Ij
            δ1   = p[o+4] + p[o+5]/1000 * (Tj - T_ref) + p[o+6]/1000 * Ij
            δ2   = p[o+7] + p[o+8]/1000 * (Tj - T_ref) + p[o+9]/1000 * Ij
            f1   = exp10(pHj - pKa1)
            f2   = exp10(2 * pHj - pKa1 - pKa2)
            Z    = 1 + f1 + f2
            pred[j] = (δ0 + δ1 * f1 + δ2 * f2) / Z
        end
        pred
    end
end

# ── Individual-condition reference fits ───────────────────────────────────────
function simple_hh(pH, p)
    pKa, δp, δd = p[1], p[2], p[3]
    @. δp + (δd - δp) / (1 + exp10(pKa - pH))
end

function simple_hh_3state(pH_vals, p)
    pKa1, pKa2, δ0, δ1, δ2 = p[1], p[2], p[3], p[4], p[5]
    [let f1 = exp10(ph - pKa1), f2 = exp10(2ph - pKa1 - pKa2), Z = 1 + f1 + f2
         (δ0 + δ1 * f1 + δ2 * f2) / Z
     end for ph in pH_vals]
end

# ── Column name parser ────────────────────────────────────────────────────────
const _MULT_MAP = Dict(
    "s" => "singlet", "d" => "doublet", "t" => "triplet",
    "q" => "quartet", "m" => "multiplet"
)

function _parse_colname(colname)
    m = match(r"^(\w+)\(([^)]+)\)$", colname)
    m === nothing && return (nucleus=colname, resonance_id=colname, multiplicity=nothing)
    nucleus = m.captures[1]
    parts = split(m.captures[2], ',')
    resonance_id = strip(parts[1])
    multiplicity = length(parts) >= 2 ? get(_MULT_MAP, strip(parts[2]), nothing) : nothing
    (nucleus=nucleus, resonance_id=resonance_id, multiplicity=multiplicity)
end

# ── Observation array builder ─────────────────────────────────────────────────
# Returns δ (Float64 matrix, NaN for missing), row_of (valid row indices per
# resonance), X (n_obs×4: I,T,pH,r) and y (n_obs chemical shift vector).
function _prepare_obs(I, T, pH, δobs)
    n_obs_all, n_res = size(δobs)
    δ = reshape(Float64[isnothing(v) ? NaN : v for v in δobs], size(δobs))
    row_of = [findall(i -> !isnan(δ[i, r]), 1:n_obs_all) for r in 1:n_res]
    n_obs = sum(length, row_of)
    X = zeros(n_obs, 4)
    y = zeros(n_obs)
    let j = 1
        for r in 1:n_res, i in row_of[r]
            X[j, 1] = I[i];  X[j, 2] = T[i];  X[j, 3] = pH[i];  X[j, 4] = r
            y[j] = δ[i, r]
            j += 1
        end
    end
    (; δ, row_of, X, y)
end

include("fit-2state.jl")
include("fit-3state.jl")
