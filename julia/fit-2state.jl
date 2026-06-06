function _guess_2state(r, rows, I, T, pH, δ, T_ref)
    isempty(rows) && return [7.0, 0.0, 0.0, 8.0, 0.0, 0.0]
    I_min = minimum(I[rows])
    sub   = findall(i -> I[rows[i]] == I_min, eachindex(rows))
    T_use = T[rows[sub[argmin(abs.(T[rows[sub]] .- T_ref))]]]
    base  = findall(i -> I[rows[i]] == I_min && T[rows[i]] == T_use, eachindex(rows))
    perm  = sortperm(pH[rows[base]])
    δs    = δ[rows[base], r]
    [δs[perm[1]], 0.0, 0.0, δs[perm[end]], 0.0, 0.0]
end

function fit_2state!(buffer, I, T, pH, δobs, colnames)
    resonances = [_parse_colname(cn) for cn in colnames]
    T_ref    = Float64(buffer["reference_temperature_K"])
    n_res    = length(resonances)
    use_ΔCp  = length(unique(T)) > 3
    n_pp     = n_pka_params(use_ΔCp)

    (; δ, row_of, X, y) = _prepare_obs(I, T, pH, δobs)

    pka_init = use_ΔCp ? [7.0, 5.0, 0.0, 0.5] : [7.0, 5.0, 0.5]
    p0 = vcat(pka_init,
              reduce(vcat, [_guess_2state(r, row_of[r], I, T, pH, δ, T_ref) for r in 1:n_res]))

    fit_result = curve_fit(make_2state_model(n_res, T_ref, use_ΔCp), X, y, p0)
    c = coef(fit_result)
    e = stderror(fit_result)

    ΔCp_fit  = use_ΔCp ? c[3] : 0.0;  ΔCp_err  = use_ΔCp ? e[3] : 0.0
    A_dh_fit = c[use_ΔCp ? 4 : 3];    A_dh_err = e[use_ΔCp ? 4 : 3]

    # ── Print results ─────────────────────────────────────────────────────────
    sep      = "─"^60
    buf_name = get(buffer, "buffer_name", "")
    println("\n$sep\n  $buf_name — pKa Parameters  (T_ref = $T_ref K)\n$sep")
    @printf("  %-20s = %10.4f ± %.4f\n",                    "pKa_ref",  c[1], e[1])
    @printf("  %-20s = %10.4f ± %.4f kJ/mol\n",             "ΔH",       c[2], e[2])
    use_ΔCp &&
    @printf("  %-20s = %10.4f ± %.4f kJ/(mol·K)\n",         "ΔCp",      c[3], e[3])
    @printf("  %-20s = %10.4f ± %.4f\n",                    "A_davies", A_dh_fit, A_dh_err)
    println("\n$sep\n  Chemical Shift Parameters\n$sep")
    shift_labels = ["δ0_prot  (ppm)  ", "α_prot   (ppb/K)", "β_prot   (ppb/M)",
                    "δ0_deprot (ppm) ", "α_deprot (ppb/K)", "β_deprot (ppb/M)"]
    for r in 1:n_res
        o = n_pp + (r - 1) * N_RES_P
        println("\n  $(resonances[r].resonance_id):")
        for k in 1:N_RES_P
            @printf("    %-22s = %10.5f ± %.5f\n", shift_labels[k], c[o+k], e[o+k])
        end
    end
    println()

    # ── Populate buffer dict ───────────────────────────────────────────────────
    pKa_entry = Dict{String,Any}(
        "pKa_index"            => 1,
        "pKa"                  => [c[1], e[1]],
        "ΔH_kJ_mol"            => [c[2], e[2]],
        "ionic_strength_model" => "davies",
        "davies_prefactor"     => [A_dh_fit, A_dh_err]
    )
    use_ΔCp && (pKa_entry["ΔCp_kJ_mol_per_K"] = [ΔCp_fit, ΔCp_err])
    haskey(buffer, "protonated_charge") && (pKa_entry["protonated_charge"] = buffer["protonated_charge"])
    buffer["pKa_parameters"] = [pKa_entry]

    chem_shifts = Dict{String,Any}()
    for r in 1:n_res
        o   = n_pp + (r - 1) * N_RES_P
        res = resonances[r]
        entry = Dict{String,Any}(
            "resonance_id"   => res.resonance_id,
            "limiting_shifts" => [
                Dict("ionisation_state" => 0,
                     "shift_ppm" => [c[o+1], e[o+1]],
                     "temperature_coefficient_ppm_per_K" => [c[o+2]/1000, e[o+2]/1000],
                     "ionic_strength_coefficient_ppm_per_M" => [c[o+3]/1000, e[o+3]/1000]),
                Dict("ionisation_state" => 1,
                     "shift_ppm" => [c[o+4], e[o+4]],
                     "temperature_coefficient_ppm_per_K" => [c[o+5]/1000, e[o+5]/1000],
                     "ionic_strength_coefficient_ppm_per_M" => [c[o+6]/1000, e[o+6]/1000])
            ]
        )
        res.multiplicity !== nothing && (entry["multiplicity"] = res.multiplicity)
        nuc = res.nucleus
        haskey(chem_shifts, nuc) || (chem_shifts[nuc] = Any[])
        push!(chem_shifts[nuc], entry)
    end
    buffer["chemical_shifts"] = chem_shifts

    # ── Plots ──────────────────────────────────────────────────────────────────
    sample_id = get(buffer, "sample_id", "unknown")
    buf_fname = replace(lowercase(buf_name), ' ' => '_')
    outdir    = joinpath("public", "plots", sample_id, buf_fname)
    mkpath(outdir)

    Ts_all  = sort(unique(T))
    Is_all  = sort(unique(I))
    colors  = Makie.wong_colors()
    T_color = Dict(Tv => colors[mod1(i, length(colors))] for (i, Tv) in enumerate(Ts_all))
    I_color = Dict(Iv => colors[mod1(i, length(colors))] for (i, Iv) in enumerate(Is_all))
    T_range = range(minimum(Ts_all) - 5, maximum(Ts_all) + 5, length=100)
    I_range = range(0.0, maximum(Is_all) + 0.05, length=100)

    # Individual HH fits at each (I, T) condition for summary plot comparison
    nan_mat() = fill(NaN, length(Is_all), length(Ts_all))
    indiv = [(pKa=nan_mat(), pKa_e=nan_mat(),
              δp=nan_mat(),  δp_e=nan_mat(),
              δd=nan_mat(),  δd_e=nan_mat()) for _ in 1:n_res]
    for r in 1:n_res
        for (ni, Iv) in enumerate(Is_all), (mt, Tv) in enumerate(Ts_all)
            idxs = findall(i -> I[row_of[r][i]] == Iv && T[row_of[r][i]] == Tv, eachindex(row_of[r]))
            length(idxs) < 4 && continue
            pHs  = pH[row_of[r][idxs]]
            δs   = δ[row_of[r][idxs], r]
            perm = sortperm(pHs)
            try
                f = curve_fit(simple_hh, pHs, δs, [c[1], δs[perm[1]], δs[perm[end]]])
                cf, ef = coef(f), stderror(f)
                any(ef .> 2) && continue
                indiv[r].pKa[ni, mt] = cf[1];  indiv[r].pKa_e[ni, mt] = ef[1]
                indiv[r].δp[ni, mt]  = cf[2];  indiv[r].δp_e[ni, mt]  = ef[2]
                indiv[r].δd[ni, mt]  = cf[3];  indiv[r].δd_e[ni, mt]  = ef[3]
            catch
            end
        end
    end

    for r in 1:n_res
        o      = n_pp + (r - 1) * N_RES_P
        res_id = resonances[r].resonance_id
        nuc    = resonances[r].nucleus

        # Titration plot
        n_I      = length(Is_all)
        fig      = Figure(size=(320 * n_I, 420))
        Label(fig[0, 1:n_I], "$buf_name — $nuc ($res_id)"; fontsize=15, font=:bold)
        pH_lo    = minimum(pH[row_of[r]])
        pH_hi    = maximum(pH[row_of[r]])
        ph_range = range(pH_lo, pH_hi, length=200)
        axs      = Axis[]
        for (ni, Iv) in enumerate(Is_all)
            ax = Axis(fig[1, ni]; title="I = $(round(Iv, digits=3)) M", xlabel="pH", ylabel="δ (ppm)")
            push!(axs, ax)
            for Tv in Ts_all
                idxs = findall(i -> I[row_of[r][i]] == Iv && T[row_of[r][i]] == Tv, eachindex(row_of[r]))
                isempty(idxs) && continue
                col  = T_color[Tv]
                scatter!(ax, pH[row_of[r][idxs]], δ[row_of[r][idxs], r]; color=col, label="$(Int(Tv)) K")
                pKa    = calc_pKa(Tv, Iv, c[1], c[2], ΔCp_fit, A_dh_fit, T_ref)
                δ_line = [calc_δobs(Tv, Iv, ph, c[o+1], c[o+2], c[o+3], c[o+4], c[o+5], c[o+6], pKa, T_ref)
                          for ph in ph_range]
                lines!(ax, collect(ph_range), δ_line; color=col)
            end
        end
        isempty(axs) || Legend(fig[1, n_I+1], axs[1], "T (K)")
        save(joinpath(outdir, "$(res_id)_titration.png"), fig)

        # Summary plot (pKa, δprot, δdeprot vs T and I)
        fig2  = Figure(size=(900, 900))
        Label(fig2[0, 1:2], "$buf_name — $nuc ($res_id)"; fontsize=15, font=:bold)
        ax_pT = Axis(fig2[1, 1]; xlabel="T (K)", ylabel="pKa",          title="pKa vs T")
        ax_pI = Axis(fig2[1, 2]; xlabel="I (M)", ylabel="pKa",          title="pKa vs I")
        ax_PT = Axis(fig2[2, 1]; xlabel="T (K)", ylabel="δprot (ppm)",   title="δprot vs T")
        ax_PI = Axis(fig2[2, 2]; xlabel="I (M)", ylabel="δprot (ppm)",   title="δprot vs I")
        ax_DT = Axis(fig2[3, 1]; xlabel="T (K)", ylabel="δdeprot (ppm)", title="δdeprot vs T")
        ax_DI = Axis(fig2[3, 2]; xlabel="I (M)", ylabel="δdeprot (ppm)", title="δdeprot vs I")

        for (ni, Iv) in enumerate(Is_all)
            col = I_color[Iv];  lbl = "I=$(round(Iv, digits=3)) M"
            for (ax, vals, errs) in [(ax_pT, indiv[r].pKa[ni, :], indiv[r].pKa_e[ni, :]),
                                     (ax_PT, indiv[r].δp[ni, :],  indiv[r].δp_e[ni, :]),
                                     (ax_DT, indiv[r].δd[ni, :],  indiv[r].δd_e[ni, :])]
                valid = findall(!isnan, vals)
                isempty(valid) && continue
                errorbars!(ax, Ts_all[valid], vals[valid], errs[valid]; color=col, whiskerwidth=8)
                scatter!(ax, Ts_all[valid], vals[valid]; color=col, marker=:circle, label=lbl)
            end
            lines!(ax_pT, collect(T_range), [calc_pKa(Tv, Iv, c[1], c[2], ΔCp_fit, A_dh_fit, T_ref) for Tv in T_range]; color=col)
            lines!(ax_PT, collect(T_range), [c[o+1] + c[o+2]/1000*(Tv - T_ref) + c[o+3]/1000*Iv for Tv in T_range]; color=col)
            lines!(ax_DT, collect(T_range), [c[o+4] + c[o+5]/1000*(Tv - T_ref) + c[o+6]/1000*Iv for Tv in T_range]; color=col)
        end
        for (mt, Tv) in enumerate(Ts_all)
            col = T_color[Tv];  lbl = "$(Int(Tv)) K"
            for (ax, vals, errs) in [(ax_pI, indiv[r].pKa[:, mt], indiv[r].pKa_e[:, mt]),
                                     (ax_PI, indiv[r].δp[:, mt],  indiv[r].δp_e[:, mt]),
                                     (ax_DI, indiv[r].δd[:, mt],  indiv[r].δd_e[:, mt])]
                valid = findall(!isnan, vals)
                isempty(valid) && continue
                errorbars!(ax, Is_all[valid], vals[valid], errs[valid]; color=col, whiskerwidth=8)
                scatter!(ax, Is_all[valid], vals[valid]; color=col, marker=:rect, label=lbl)
            end
            lines!(ax_pI, collect(I_range), [calc_pKa(Tv, Iv, c[1], c[2], ΔCp_fit, A_dh_fit, T_ref) for Iv in I_range]; color=col, linestyle=:dash)
            lines!(ax_PI, collect(I_range), [c[o+1] + c[o+2]/1000*(Tv - T_ref) + c[o+3]/1000*Iv for Iv in I_range]; color=col, linestyle=:dash)
            lines!(ax_DI, collect(I_range), [c[o+4] + c[o+5]/1000*(Tv - T_ref) + c[o+6]/1000*Iv for Iv in I_range]; color=col, linestyle=:dash)
        end

        I_entries = [[LineElement(color=I_color[Iv]),
                      MarkerElement(marker=:circle, color=I_color[Iv], markersize=10)] for Iv in Is_all]
        T_entries = [[LineElement(color=T_color[Tv], linestyle=:dash),
                      MarkerElement(marker=:rect,   color=T_color[Tv], markersize=10)] for Tv in Ts_all]
        I_labels  = ["I=$(round(Iv, digits=3)) M" for Iv in Is_all]
        T_labels  = ["$(Int(Tv)) K"               for Tv in Ts_all]
        Legend(fig2[1:3, 3], [I_entries, T_entries], [I_labels, T_labels], ["I (M)", "T (K)"])
        save(joinpath(outdir, "$(res_id)_summary.png"), fig2)
    end
end
