using CairoMakie
using Dates
using LsqFit
using JSON
using Printf
using YAML


include("buffers.jl")
include("fitting.jl")

db = Dict{String,Any}()

# boilerplate
db["\$schema"] = "schema.json"
version = length(ARGS) >= 1 ? ARGS[1] : "dev"
db["database_version"] = version
# date as RFC 3339
db["last_updated"] = Dates.format(now(UTC), "yyyy-mm-ddTHH:MM:SS.sssZ")

db["samples"] = Vector{Dict{String,Any}}()
db["buffers"] = Vector{Dict{String,Any}}()

# process samples
# get list of directories in data/
samples = basename.(filter(isdir, readdir("data", join=true)))
for sample in samples
    @info "Processing sample $sample"
    sample_path = joinpath("data", sample, "sample.yaml")
    if isfile(sample_path)
        sample_data = YAML.load_file(sample_path)
        sample_data["sample_id"] = sample # populate sample_id from folder name
    else
        @warn "No sample.yaml found for $sample, skipping"
        continue
    end
    pHmin = 1000.
    pHmax = -1000.
    Tmin = 1000.
    Tmax = -1000.
    Imin = 1000.
    Imax = -1000.
    # get list of buffers - yaml files in data/sample excluding sample.yaml
    buffer_files = filter(f -> endswith(f, ".yaml") && f != "sample.yaml", readdir(joinpath("data", sample)))
    for buffer_file in buffer_files
        buffer_path = joinpath("data", sample, buffer_file)
        buffer_data = YAML.load_file(buffer_path)
        buffer_data["sample_id"] = sample
        buffer_data["reference_temperature_K"] = sample_data["reference_temperature_K"]
        retval = processbuffer!(buffer_data)
        if retval === nothing
            @warn "Buffer $buffer_file in sample $sample could not be processed, skipping"
            continue
        end
        pH_min, pH_max, T_min, T_max, I_min, I_max = retval
        pHmin = min(pHmin, pH_min)
        pHmax = max(pHmax, pH_max)
        Tmin = min(Tmin, T_min)
        Tmax = max(Tmax, T_max)
        Imin = min(Imin, I_min)
        Imax = max(Imax, I_max)
        push!(db["buffers"], buffer_data)
    end
    # save measurement ranges for sample (min/max of all buffers)
    sample_data["measurement_ranges"] = Dict(
        "pH" => [pHmin, pHmax],
        "temperature_K" => [Tmin, Tmax],
        "ionic_strength_M" => [Imin, Imax]
    )
    # save sample data to database
    push!(db["samples"], sample_data)
end

# save database as json file
mkpath(joinpath("public", "database"))
open(joinpath("public", "database", "database.json"), "w") do f
    JSON.print(f, db, 4)
end
@info "Database saved to public/database/database.json"

# generate plots manifest so the viewer page can enumerate available plots
plots_dir = joinpath("public", "plots")
buf_name_lookup = Dict{Tuple{String,String},String}()
for buf in db["buffers"]
    sid      = get(buf, "sample_id", "")
    bname    = get(buf, "buffer_name", "")
    buf_fname = replace(lowercase(bname), ' ' => '_')
    buf_name_lookup[(sid, buf_fname)] = bname
end
manifest = Dict{String,Any}(
    "generated" => Dates.format(now(UTC), "yyyy-mm-ddTHH:MM:SS.sssZ"),
    "samples"   => [])
for sample in db["samples"]
    sample_id       = sample["sample_id"]
    sample_plots_dir = joinpath(plots_dir, sample_id)
    isdir(sample_plots_dir) || continue
    sample_entry = Dict{String,Any}(
        "sample_id" => sample_id,
        "solvent"   => get(sample, "solvent", ""),
        "buffers"   => [])
    for buf_dir in sort(readdir(sample_plots_dir))
        buf_path = joinpath(sample_plots_dir, buf_dir)
        isdir(buf_path) || continue
        pngs = sort(filter(f -> endswith(f, ".png"), readdir(buf_path)))
        resonances = Dict{String,Any}()
        for png in pngs
            m = match(r"^(.+)_(titration|summary)\.png$", png)
            m === nothing && continue
            res_id, plot_type = m.captures
            haskey(resonances, res_id) || (resonances[res_id] = Dict{String,Any}("resonance_id" => res_id))
            resonances[res_id][plot_type] = png
        end
        isempty(resonances) && continue
        bname = get(buf_name_lookup, (sample_id, buf_dir),
                    titlecase(replace(buf_dir, '_' => ' ')))
        push!(sample_entry["buffers"], Dict{String,Any}(
            "dir"         => joinpath(sample_id, buf_dir),
            "buffer_name" => bname,
            "resonances"  => sort(collect(values(resonances)), by=r->r["resonance_id"])))
    end
    push!(manifest["samples"], sample_entry)
end
mkpath(plots_dir)
open(joinpath(plots_dir, "manifest.json"), "w") do f
    JSON.print(f, manifest, 4)
end
@info "Plots manifest saved to public/plots/manifest.json"