function processbuffer!(buffer)
    @info "Processing buffer $(buffer["buffer_name"]) in sample $(buffer["sample_id"])"
    # pop data from buffer dictionary
    data = pop!(buffer, "data", nothing)
    # data = get(buffer, "data", nothing)
    if data === nothing
        @warn "No data field found in buffer, skipping"
        return
    end
    # process first row of tab/space separated data as column names
    # e.g. first row = "I T	pH	19F(F_ortho)	19F(F_para) 1H(H_meta)"
    # NB. bracket contents may contain spaces - no not split on these
    # might need to use a regex to split on tabs/spaces that are not within brackets
    lines = split(strip(data), '\n')
    header = popfirst!(lines)
    # split header on tabs/spaces that are not within brackets
    colnames = collect(eachmatch(r"\S+\([^)]*\)|\S+", header))
    colnames = [m.match for m in colnames]
    idx_I = findfirst(==("I"), colnames)
    idx_T = findfirst(==("T"), colnames)
    idx_pH = findfirst(==("pH"), colnames)
    if idx_I === nothing || idx_T === nothing || idx_pH === nothing
        @warn "Could not find I, T, or pH columns in buffer data, skipping"
        return
    end
    # parse each line; filter out rows where I, T, or pH are missing
    parsed = [tryparse.(Float64, split(line)) for line in lines if !isempty(strip(line))]
    filter!(row -> length(row) >= max(idx_I, idx_T, idx_pH) &&
                   !isnothing(row[idx_I]) && !isnothing(row[idx_T]) && !isnothing(row[idx_pH]),
            parsed)
    if isempty(parsed)
        @warn "No valid rows found in buffer, skipping"
        return
    end

    I   = Float64[row[idx_I]  for row in parsed]
    T   = Float64[row[idx_T]  for row in parsed]
    pH  = Float64[row[idx_pH] for row in parsed]

    # chemical shift columns (4:end); missing entries become NaN and are filtered
    # per-resonance inside _prepare_obs via row_of
    n_shift_cols = length(colnames) - 3
    colnames = colnames[4:end]
    δobs = Float64[i + 3 <= length(row) && !isnothing(row[i+3]) ? row[i+3] : NaN
                   for row in parsed, i in 1:n_shift_cols]

    if buffer["ionisation_states"] == 2
        fit_2state!(buffer, I, T, pH, δobs, colnames)
    elseif buffer["ionisation_states"] == 3
        fit_3state!(buffer, I, T, pH, δobs, colnames)
    else
        @warn "Unsupported number of ionisation states, skipping"
        return
    end

    return minimum(pH), maximum(pH), minimum(T), maximum(T), minimum(I), maximum(I)
end
