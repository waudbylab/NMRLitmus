function _guess_3state_pKas(rows, I, T, pH, T_ref)
    isempty(rows) && return (5.0, 9.0)
    I_min = minimum(I[rows])
    sub   = findall(i -> I[rows[i]] == I_min, eachindex(rows))
    T_use = T[rows[sub[argmin(abs.(T[rows[sub]] .- T_ref))]]]
    base  = findall(i -> I[rows[i]] == I_min && T[rows[i]] == T_use, eachindex(rows))
    pHs   = pH[rows[base]]
    pH_lo, pH_hi = minimum(pHs), maximum(pHs)
    span  = pH_hi - pH_lo
    # Use pH range thirds as rough estimates for the two inflection points
    return pH_lo + span / 3, pH_lo + 2 * span / 3
end

function _guess_3state_shifts(r, rows, I, T, pH, δ, T_ref)
    isempty(rows) && return [3.0, 0.0, 0.0, 3.1, 0.0, 0.0, 3.2, 0.0, 0.0]
    I_min = minimum(I[rows])
    sub   = findall(i -> I[rows[i]] == I_min, eachindex(rows))
    T_use = T[rows[sub[argmin(abs.(T[rows[sub]] .- T_ref))]]]
    base  = findall(i -> I[rows[i]] == I_min && T[rows[i]] == T_use, eachindex(rows))
    perm  = sortperm(pH[rows[base]])
    δs    = δ[rows[base], r]
    n     = length(perm)
    [δs[perm[1]], 0.0, 0.0, δs[perm[n÷2+1]], 0.0, 0.0, δs[perm[end]], 0.0, 0.0]
end

function fit_3state!(buffer, I, T, pH, δobs, colnames)
    resonances = [_parse_colname(cn) for cn in colnames]
    T_ref    = Float64(buffer["reference_temperature_K"])
    n_res    = length(resonances)
    use_ΔCp  = length(unique(T)) > 3
    n_pp     = n_pka_params(use_ΔCp)
    n_tot    = 2 * n_pp

    (; δ, row_of, X, y) = _prepare_obs(I, T, pH, δobs)

    pKa1_0, pKa2_0 = _guess_3state_pKas(row_of[1], I, T, pH, T_ref)
    pka_init = use_ΔCp ? [pKa1_0, 5.0, 0.0, 0.5, pKa2_0, 5.0, 0.0, 0.5] :
                         [pKa1_0, 5.0, 0.5, pKa2_0, 5.0, 0.5]
    p0 = vcat(pka_init,
              reduce(vcat, [_guess_3state_shifts(r, row_of[r], I, T, pH, δ, T_ref) for r in 1:n_res]))

    fit_result = curve_fit(make_3state_model(n_res, T_ref, use_ΔCp), X, y, p0)
    c = coef(fit_result)
    e = stderror(fit_result)

    ΔCp1_fit = use_ΔCp ? c[3]        : 0.0;  ΔCp1_err = use_ΔCp ? e[3]        : 0.0
    A_dh1_fit = c[use_ΔCp ? 4 : 3];          A_dh1_err = e[use_ΔCp ? 4 : 3]
    ΔCp2_fit = use_ΔCp ? c[n_pp+3]   : 0.0;  ΔCp2_err = use_ΔCp ? e[n_pp+3]   : 0.0
    A_dh2_fit = c[use_ΔCp ? n_pp+4 : n_pp+3]; A_dh2_err = e[use_ΔCp ? n_pp+4 : n_pp+3]

    # ── Print results ─────────────────────────────────────────────────────────
    sep      = "─"^60
    buf_name = get(buffer, "buffer_name", "")
    println("\n$sep\n  $buf_name — pKa Parameters  (T_ref = $T_ref K)\n$sep")
    for ki in 1:2
        base = (ki-1)*n_pp + 1
        @printf("  %-20s = %10.4f ± %.4f\n",              "pKa$(ki)_ref",    c[base],   e[base])
        @printf("  %-20s = %10.4f ± %.4f kJ/mol\n",       "ΔH$(ki)",         c[base+1], e[base+1])
        use_ΔCp &&
        @printf("  %-20s = %10.4f ± %.4f kJ/(mol·K)\n",   "ΔCp$(ki)",        c[base+2], e[base+2])
        A_dh = ki == 1 ? A_dh1_fit : A_dh2_fit
        A_err = ki == 1 ? A_dh1_err : A_dh2_err
        @printf("  %-20s = %10.4f ± %.4f\n",              "A_davies$(ki)",   A_dh,      A_err)
    end
    println("\n$sep\n  Chemical Shift Parameters\n$sep")
    shift_labels = ["δ0_0 (ppm)  ", "α_0  (ppb/K)", "β_0  (ppb/M)",
                    "δ0_1 (ppm)  ", "α_1  (ppb/K)", "β_1  (ppb/M)",
                    "δ0_2 (ppm)  ", "α_2  (ppb/K)", "β_2  (ppb/M)"]
    for r in 1:n_res
        o = n_tot + (r - 1) * N_RES_P_3S
        println("\n  $(resonances[r].resonance_id):")
        for k in 1:N_RES_P_3S
            @printf("    %-22s = %10.5f ± %.5f\n", shift_labels[k], c[o+k], e[o+k])
        end
    end
    println()

    # ── Populate buffer dict ───────────────────────────────────────────────────
    z_prot = get(buffer, "protonated_charge", nothing)
    ΔCp_fits = (ΔCp1_fit, ΔCp2_fit);  ΔCp_errs = (ΔCp1_err, ΔCp2_err)
    A_dh_fits = (A_dh1_fit, A_dh2_fit);  A_dh_errs = (A_dh1_err, A_dh2_err)
    buffer["pKa_parameters"] = map(1:2) do ki
        base  = (ki-1)*n_pp + 1
        entry = Dict{String,Any}(
            "pKa_index"            => ki,
            "pKa"                  => [c[base],   e[base]],
            "ΔH_kJ_mol"            => [c[base+1], e[base+1]],
            "ionic_strength_model" => "davies",
            "davies_prefactor"     => [A_dh_fits[ki], A_dh_errs[ki]]
        )
        use_ΔCp && (entry["ΔCp_kJ_mol_per_K"] = [ΔCp_fits[ki], ΔCp_errs[ki]])
        z_prot !== nothing && (entry["protonated_charge"] = z_prot - (ki - 1))
        entry
    end

    chem_shifts = Dict{String,Any}()
    for r in 1:n_res
        o   = n_tot + (r - 1) * N_RES_P_3S
        res = resonances[r]
        limiting_shifts = map(0:2) do s
            ks = 3s + 1
            Dict("ionisation_state" => s,
                 "shift_ppm"                              => [c[o+ks],         e[o+ks]],
                 "temperature_coefficient_ppm_per_K"      => [c[o+ks+1]/1000,  e[o+ks+1]/1000],
                 "ionic_strength_coefficient_ppm_per_M"   => [c[o+ks+2]/1000,  e[o+ks+2]/1000])
        end
        entry = Dict{String,Any}("resonance_id" => res.resonance_id,
                                  "limiting_shifts" => limiting_shifts)
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

    # Individual 3-state fits at each (I, T) condition for summary plot comparison
    nan_mat() = fill(NaN, length(Is_all), length(Ts_all))
    indiv = [(pKa1=nan_mat(), pKa1_e=nan_mat(), pKa2=nan_mat(), pKa2_e=nan_mat(),
              δ0=nan_mat(),   δ0_e=nan_mat(),
              δ1=nan_mat(),   δ1_e=nan_mat(),
              δ2=nan_mat(),   δ2_e=nan_mat()) for _ in 1:n_res]
    for r in 1:n_res
        for (ni, Iv) in enumerate(Is_all), (mt, Tv) in enumerate(Ts_all)
            idxs = findall(i -> I[row_of[r][i]] == Iv && T[row_of[r][i]] == Tv, eachindex(row_of[r]))
            length(idxs) < 6 && continue
            pHs  = pH[row_of[r][idxs]]
            δs   = δ[row_of[r][idxs], r]
            perm = sortperm(pHs)
            p0s  = [c[1], c[n_pp+1], δs[perm[1]], δs[perm[length(perm)÷2+1]], δs[perm[end]]]
            try
                f = curve_fit(simple_hh_3state, pHs, δs, p0s)
                cf, ef = coef(f), stderror(f)
                any(ef .> 2) && continue
                indiv[r].pKa1[ni,mt]=cf[1]; indiv[r].pKa1_e[ni,mt]=ef[1]
                indiv[r].pKa2[ni,mt]=cf[2]; indiv[r].pKa2_e[ni,mt]=ef[2]
                indiv[r].δ0[ni,mt]  =cf[3]; indiv[r].δ0_e[ni,mt]  =ef[3]
                indiv[r].δ1[ni,mt]  =cf[4]; indiv[r].δ1_e[ni,mt]  =ef[4]
                indiv[r].δ2[ni,mt]  =cf[5]; indiv[r].δ2_e[ni,mt]  =ef[5]
            catch
            end
        end
    end

    for r in 1:n_res
        o      = n_tot + (r - 1) * N_RES_P_3S
        res_id = resonances[r].resonance_id
        nuc    = resonances[r].nucleus

        # Titration plot
        n_I      = length(Is_all)
        fig      = Figure(size=(320 * n_I, 420))
        Label(fig[0, 1:n_I], "$buf_name — $nuc ($res_id)"; fontsize=15, font=:bold)
        ph_range = range(minimum(pH[row_of[r]]), maximum(pH[row_of[r]]), length=200)
        axs      = Axis[]
        for (ni, Iv) in enumerate(Is_all)
            ax = Axis(fig[1, ni]; title="I = $(round(Iv, digits=3)) M", xlabel="pH", ylabel="δ (ppm)")
            push!(axs, ax)
            for Tv in Ts_all
                idxs = findall(i -> I[row_of[r][i]] == Iv && T[row_of[r][i]] == Tv, eachindex(row_of[r]))
                isempty(idxs) && continue
                col  = T_color[Tv]
                scatter!(ax, pH[row_of[r][idxs]], δ[row_of[r][idxs], r]; color=col, label="$(Int(Tv)) K")
                pKa1  = calc_pKa(Tv, Iv, c[1],        c[2],        ΔCp1_fit, A_dh1_fit, T_ref)
                pKa2  = calc_pKa(Tv, Iv, c[n_pp+1],   c[n_pp+2],   ΔCp2_fit, A_dh2_fit, T_ref)
                δ0v   = c[o+1] + c[o+2]/1000 * (Tv - T_ref) + c[o+3]/1000 * Iv
                δ1v   = c[o+4] + c[o+5]/1000 * (Tv - T_ref) + c[o+6]/1000 * Iv
                δ2v   = c[o+7] + c[o+8]/1000 * (Tv - T_ref) + c[o+9]/1000 * Iv
                δ_line = [let f1=exp10(ph-pKa1), f2=exp10(2ph-pKa1-pKa2), Z=1+f1+f2
                              (δ0v + δ1v*f1 + δ2v*f2) / Z end for ph in ph_range]
                lines!(ax, collect(ph_range), δ_line; color=col)
            end
        end
        isempty(axs) || Legend(fig[1, n_I+1], axs[1], "T (K)")
        save(joinpath(outdir, "$(res_id)_titration.png"), fig)

        # Summary plot: 5 rows (pKa1, pKa2, δ0, δ1, δ2) × 2 cols (vs T, vs I)
        fig2    = Figure(size=(900, 1400))
        Label(fig2[0, 1:2], "$buf_name — $nuc ($res_id)"; fontsize=15, font=:bold)
        axes_T  = [Axis(fig2[row, 1]) for row in 1:5]
        axes_I  = [Axis(fig2[row, 2]) for row in 1:5]
        ylabels = ["pKa1", "pKa2", "δ_0 (ppm)", "δ_1 (ppm)", "δ_2 (ppm)"]
        for (ax, lbl) in zip(axes_T, ylabels);  ax.ylabel = lbl;  end
        for ax in axes_T;  ax.xlabel = "T (K)";  end
        for ax in axes_I;  ax.xlabel = "I (M)";  end
        for (ax, t) in zip(axes_T, ["pKa1 vs T","pKa2 vs T","δ_0 vs T","δ_1 vs T","δ_2 vs T"])
            ax.title = t
        end
        for (ax, t) in zip(axes_I, ["pKa1 vs I","pKa2 vs I","δ_0 vs I","δ_1 vs I","δ_2 vs I"])
            ax.title = t
        end

        indiv_vals = [indiv[r].pKa1, indiv[r].pKa2, indiv[r].δ0, indiv[r].δ1, indiv[r].δ2]
        indiv_errs = [indiv[r].pKa1_e, indiv[r].pKa2_e, indiv[r].δ0_e, indiv[r].δ1_e, indiv[r].δ2_e]

        for (ni, Iv) in enumerate(Is_all)
            col = I_color[Iv];  lbl = "I=$(round(Iv, digits=3)) M"
            for (ax, vals, errs) in zip(axes_T, [v[ni,:] for v in indiv_vals], [v[ni,:] for v in indiv_errs])
                valid = findall(!isnan, vals)
                isempty(valid) && continue
                errorbars!(ax, Ts_all[valid], vals[valid], errs[valid]; color=col, whiskerwidth=8)
                scatter!(ax, Ts_all[valid], vals[valid]; color=col, marker=:circle, label=lbl)
            end
            lines!(axes_T[1], collect(T_range),
                   [calc_pKa(Tv, Iv, c[1],      c[2],      ΔCp1_fit, A_dh1_fit, T_ref) for Tv in T_range]; color=col)
            lines!(axes_T[2], collect(T_range),
                   [calc_pKa(Tv, Iv, c[n_pp+1], c[n_pp+2], ΔCp2_fit, A_dh2_fit, T_ref) for Tv in T_range]; color=col)
            for (ax, ks) in zip(axes_T[3:5], [(1,2,3), (4,5,6), (7,8,9)])
                k1, k2, k3 = ks
                lines!(ax, collect(T_range),
                       [c[o+k1] + c[o+k2]/1000*(Tv - T_ref) + c[o+k3]/1000*Iv for Tv in T_range]; color=col)
            end
        end

        for (mt, Tv) in enumerate(Ts_all)
            col = T_color[Tv];  lbl = "$(Int(Tv)) K"
            for (ax, vals, errs) in zip(axes_I, [v[:,mt] for v in indiv_vals], [v[:,mt] for v in indiv_errs])
                valid = findall(!isnan, vals)
                isempty(valid) && continue
                errorbars!(ax, Is_all[valid], vals[valid], errs[valid]; color=col, whiskerwidth=8)
                scatter!(ax, Is_all[valid], vals[valid]; color=col, marker=:rect, label=lbl)
            end
            lines!(axes_I[1], collect(I_range),
                   [calc_pKa(Tv, Iv, c[1],      c[2],      ΔCp1_fit, A_dh1_fit, T_ref) for Iv in I_range]; color=col, linestyle=:dash)
            lines!(axes_I[2], collect(I_range),
                   [calc_pKa(Tv, Iv, c[n_pp+1], c[n_pp+2], ΔCp2_fit, A_dh2_fit, T_ref) for Iv in I_range]; color=col, linestyle=:dash)
            for (ax, ks) in zip(axes_I[3:5], [(1,2,3), (4,5,6), (7,8,9)])
                k1, k2, k3 = ks
                lines!(ax, collect(I_range),
                       [c[o+k1] + c[o+k2]/1000*(Tv - T_ref) + c[o+k3]/1000*Iv for Iv in I_range]; color=col, linestyle=:dash)
            end
        end

        I_entries = [[LineElement(color=I_color[Iv]),
                      MarkerElement(marker=:circle, color=I_color[Iv], markersize=10)] for Iv in Is_all]
        T_entries = [[LineElement(color=T_color[Tv], linestyle=:dash),
                      MarkerElement(marker=:rect,   color=T_color[Tv], markersize=10)] for Tv in Ts_all]
        I_labels  = ["I=$(round(Iv, digits=3)) M" for Iv in Is_all]
        T_labels  = ["$(Int(Tv)) K"               for Tv in Ts_all]
        Legend(fig2[1:5, 3], [I_entries, T_entries], [I_labels, T_labels], ["I (M)", "T (K)"])
        save(joinpath(outdir, "$(res_id)_summary.png"), fig2)
    end
end
