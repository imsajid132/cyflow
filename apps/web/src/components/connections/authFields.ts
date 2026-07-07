import { useEffect, useState } from "react";
import { api, apiEnabled, type AuthFieldDTO } from "../../store/api";
import { findApp } from "../../data/catalog";

/**
 * Local fallback fields when no API is available to describe the auth schema.
 * (In API mode the real schema comes from `GET /apps/:key/auth`.)
 */
export function defaultAuthFields(authType?: string, appKey?: string): AuthFieldDTO[] {
  // Apps with custom multi-field auth (offline/demo fallback for the API schema).
  if (appKey === "supabase") {
    return [
      { key: "projectUrl", label: "Project URL", type: "text", required: true },
      { key: "serviceKey", label: "Service role key", type: "password", required: true },
    ];
  }
  if (appKey === "trello") {
    return [
      { key: "apiKey", label: "API key", type: "text", required: true },
      { key: "token", label: "Token", type: "password", required: true },
    ];
  }
  if (appKey === "twilio") {
    return [
      { key: "accountSid", label: "Account SID", type: "text", required: true },
      { key: "authToken", label: "Auth Token", type: "password", required: true },
    ];
  }
  if (appKey === "shopify") {
    return [
      { key: "shop", label: "Shop (mystore or mystore.myshopify.com)", type: "text", required: true },
      { key: "accessToken", label: "Admin API access token", type: "password", required: true },
    ];
  }
  if (appKey === "woocommerce") {
    return [
      { key: "storeUrl", label: "Store URL", type: "text", required: true },
      { key: "consumerKey", label: "Consumer key", type: "text", required: true },
      { key: "consumerSecret", label: "Consumer secret", type: "password", required: true },
    ];
  }
  if (appKey === "whatsapp") {
    return [
      { key: "accessToken", label: "Access token", type: "password", required: true },
      { key: "phoneNumberId", label: "Phone number ID", type: "text", required: true },
    ];
  }
  if (appKey === "postgres" || appKey === "mysql" || appKey === "redis") {
    return [{ key: "connectionString", label: "Connection string", type: "password", required: true }];
  }
  if (appKey === "mongodb") {
    return [
      { key: "uri", label: "Connection URI", type: "password", required: true },
      { key: "database", label: "Database", type: "text", required: true },
    ];
  }
  if (appKey === "smtp") {
    return [
      { key: "host", label: "SMTP host", type: "text", required: true },
      { key: "port", label: "Port", type: "text", required: false },
      { key: "username", label: "Username", type: "text", required: true },
      { key: "password", label: "Password", type: "password", required: true },
      { key: "secure", label: "Use TLS (true/false)", type: "text", required: false },
    ];
  }
  switch (authType) {
    case "api_key":
      return [{ key: "token", label: "API key", type: "password", required: true }];
    case "bearer_token":
      return [{ key: "token", label: "Token", type: "password", required: true }];
    case "basic_auth":
      return [
        { key: "username", label: "Username", type: "text", required: true },
        { key: "password", label: "Password", type: "password", required: true },
      ];
    default:
      return [];
  }
}

/** Load the real auth-field schema for an app (API) with a local fallback. */
export function useAuthFields(appKey: string): AuthFieldDTO[] {
  const [fields, setFields] = useState<AuthFieldDTO[]>([]);
  const authType = findApp(appKey)?.auth;
  useEffect(() => {
    if (!appKey) {
      setFields([]);
      return;
    }
    let cancelled = false;
    if (apiEnabled) {
      api
        .getAppAuth(appKey)
        .then((dto) => {
          if (!cancelled) setFields(dto.auth.fields ?? defaultAuthFields(dto.auth.type, appKey));
        })
        .catch(() => {
          if (!cancelled) setFields(defaultAuthFields(authType, appKey));
        });
    } else {
      setFields(defaultAuthFields(authType, appKey));
    }
    return () => {
      cancelled = true;
    };
  }, [appKey]); // eslint-disable-line react-hooks/exhaustive-deps
  return fields;
}
