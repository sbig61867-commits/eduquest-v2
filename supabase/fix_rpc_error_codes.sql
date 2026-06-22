CREATE OR REPLACE FUNCTION get_invitation_by_token(p_token TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  inv RECORD;
BEGIN
  -- First check if token exists at all (regardless of status/expiry)
  SELECT i.email, i.role, i.expires_at, i.status, t.name AS tenant_name
  INTO inv
  FROM invitations i
  JOIN tenants t ON t.id = i.tenant_id
  WHERE i.token = p_token;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'NOT_FOUND');
  END IF;

  IF inv.status = 'accepted' THEN
    RETURN json_build_object('error', 'USED');
  END IF;

  IF inv.status = 'revoked' THEN
    RETURN json_build_object('error', 'REVOKED');
  END IF;

  IF inv.expires_at <= NOW() THEN
    RETURN json_build_object('error', 'EXPIRED');
  END IF;

  -- Valid pending invitation
  RETURN json_build_object(
    'email',       inv.email,
    'role',        inv.role,
    'tenant_name', inv.tenant_name,
    'expires_at',  inv.expires_at
  );
END;
$$;
