# Equipment registry and service codes

## Equipment registry (Equipment in the top menu)
One row per equipment model. Reports name a model by a short code (TR4, TR201); the registry adds:
- manufacturer, kind (transmitter, meter, combo, repeater, collector, receiver), reading system, services, other names reports use;
- status: current, phasing out, obsolete, and the model that replaces it;
- the catalog part quoted to replace one, and the battery it takes (both point at catalog parts, so prices stay dated in the catalog and a price change needs no edit here).

What uses it:
- **New WAs and Proposals**: a Needs Service transmitter or meter line is priced with the installed model's replacement part. If the model is phasing out or obsolete and has a replacement, the replacement's part is quoted and the line says "TR201 is obsolete; replace with TR4". A property's own negotiated price still wins on price. Issued documents never change.
- **Batteries** (PM lines and stopped transmitters with a flat battery): the model's battery; otherwise a catalog battery named after the model; otherwise the default battery price setting.
- **Property overview**: equipment in the field with counts, obsolete and phasing-out models flagged.
- **Equipment page**: every model with its parts, prices and how many are in the field, plus model codes seen in imports that are not in the registry yet, each with an Add button. The add form suggests catalog parts and batteries that name the model (in the name, part number or notes); a person picks.

Starter models (shipped with the app): Next Century TR4 (current, comes with a battery fitted) and TR201 (obsolete, replaced by TR4). Meters are tracked the same way: a meter's model is learned from the Meter Type on status reports (only filled in when the meter has none on file).

A new transmitter comes with a battery fitted: replacing a transmitter never adds a battery to the bring list. Only PM battery lines and stopped transmitters with a flat battery do.

Rules: one code (model or other name) means one model of a kind; a replacement chain cannot loop; models are changed, never deleted; every change is in the activity log and on the model's page.

## Service codes (Admin → Service codes)
The ServiceID codes the billing system uses: WS Water, GS Gas, EL Electric, HW Hot Water, CW Chilled Water, HV HVAC, WA Water (alternate code). More can be added. Each code has words other reports use for it ("All Water", "hot water"). A report value is read as a service only on an exact match with a code, name or word (ignoring capitals and punctuation). Codes cannot be renamed (units are filed under them); retired codes are still read on old files.

The import wizard reads services from this list. The built-in report readers use the standard list above, then their old rule (gas, electric, otherwise water) for anything else.
