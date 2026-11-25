-- Feature flags for the remaining PROJECT.md features (phases 3 to 5). Each is switched on or off, and given a minimum
-- role, on /admin/features exactly like the existing ones. A feature is only available when its code exists.

insert into public.feature_flags (feature, description, default_enabled, min_role) values
  ('digital_card',    'Public digital business card with QR code and vCard',        true,  'member'),
  ('campaigns',       'Banner campaigns with scheduling and A/B tests',             true,  'admin'),
  ('crm_sync',        'Fill signature fields from a CRM',                           true,  'admin'),
  ('directory_sync',  'Import people from Google Workspace or Microsoft 365',       true,  'admin'),
  ('health_monitor',  'Alert when a deployed signature is edited or removed',       true,  'admin'),
  ('agency_mode',     'Manage several client organizations',                        false, 'admin'),
  ('render_previews', 'Rendered previews in several email engines',                 true,  'member');
