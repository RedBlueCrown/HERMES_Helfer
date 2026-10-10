import {
  Avatar,
  Badge,
  Button,
  Caption1,
  Menu,
  MenuDivider,
  MenuGroup,
  MenuGroupHeader,
  MenuItem,
  MenuItemRadio,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Text,
  makeStyles,
  mergeClasses,
  tokens,
} from "@fluentui/react-components";
import { GLOBAL_ROLE_LABELS } from "@hermes-helfer/core";
import { useQueryClient } from "@tanstack/react-query";
import { Link, NavLink } from "react-router-dom";
import { useDevUsers, useMe } from "../api/hooks";
import { useAuth } from "../auth/auth";

const useStyles = makeStyles({
  bar: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalL,
    padding: `0 ${tokens.spacingHorizontalXL}`,
    height: "56px",
    backgroundColor: tokens.colorNeutralBackground1,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    position: "sticky",
    top: 0,
    zIndex: 10,
  },
  brand: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    textDecoration: "none",
    color: "inherit",
  },
  logo: { width: "28px", height: "28px" },
  brandText: { display: "flex", flexDirection: "column", lineHeight: 1.1 },
  nav: {
    display: "flex",
    alignSelf: "stretch",
    gap: tokens.spacingHorizontalXS,
    marginLeft: tokens.spacingHorizontalL,
  },
  navLink: {
    display: "flex",
    alignItems: "center",
    padding: `0 ${tokens.spacingHorizontalM}`,
    color: tokens.colorNeutralForeground2,
    textDecoration: "none",
    borderBottom: "3px solid transparent",
    ":hover": { color: tokens.colorNeutralForeground1, backgroundColor: tokens.colorNeutralBackground1Hover },
    ":focus-visible": { outline: `2px solid ${tokens.colorStrokeFocus2}`, outlineOffset: "-2px" },
  },
  navActive: {
    color: tokens.colorNeutralForeground1,
    fontWeight: tokens.fontWeightSemibold,
    borderBottomColor: tokens.colorBrandStroke1,
  },
  spacer: { flexGrow: 1 },
  user: { display: "flex", alignItems: "center", gap: tokens.spacingHorizontalS },
});

export function AppHeader() {
  const s = useStyles();
  const auth = useAuth();
  const me = useMe();
  const devUsers = useDevUsers(auth.mode === "dev");
  const qc = useQueryClient();
  const name = me.data?.displayName ?? "…";
  const roles = (me.data?.globalRoles ?? []).filter((r) => r !== "HH.User").map((r) => GLOBAL_ROLE_LABELS[r]);

  return (
    <header className={s.bar}>
      <Link to="/" className={s.brand}>
        <img src="/favicon.svg" alt="" className={s.logo} />
        <span className={s.brandText}>
          <Text weight="semibold">HERMES Helfer</Text>
          <Caption1>Firma Muster AG</Caption1>
        </span>
      </Link>
      <nav className={s.nav} aria-label="Hauptnavigation">
        <NavLink to="/" end className={({ isActive }) => mergeClasses(s.navLink, isActive && s.navActive)}>
          Vorhaben
        </NavLink>
        <NavLink
          to="/portfolio"
          className={({ isActive }) => mergeClasses(s.navLink, isActive && s.navActive)}
        >
          Portfolio
        </NavLink>
      </nav>
      {auth.mode === "dev" ? (
        <Badge appearance="filled" color="warning" title="Anmeldung mit fiktiven Personen, nur lokal">
          Testmodus
        </Badge>
      ) : null}
      <span className={s.spacer} />
      <Menu
        checkedValues={{ user: auth.devUserId ? [auth.devUserId] : [] }}
        onCheckedValueChange={(_, data) => {
          const id = data.checkedItems[0];
          if (id && id !== auth.devUserId) {
            auth.setDevUser(id);
            qc.clear();
          }
        }}
      >
        <MenuTrigger disableButtonEnhancement>
          <Button appearance="subtle" className={s.user} aria-label={`Konto: ${name}`}>
            <Avatar name={name} size={28} />
            <span>
              <Text block>{name}</Text>
              {roles.length ? <Caption1>{roles.join(", ")}</Caption1> : null}
            </span>
          </Button>
        </MenuTrigger>
        <MenuPopover>
          <MenuList>
            {auth.mode === "dev" ? (
              <MenuGroup>
                <MenuGroupHeader>Als andere Person anmelden (nur Testmodus)</MenuGroupHeader>
                {(devUsers.data ?? []).map((u) => (
                  <MenuItemRadio key={u.id} name="user" value={u.id} secondaryContent={u.description}>
                    {u.displayName}
                  </MenuItemRadio>
                ))}
              </MenuGroup>
            ) : (
              <>
                <MenuGroup>
                  <MenuGroupHeader>{me.data?.upn}</MenuGroupHeader>
                </MenuGroup>
                <MenuDivider />
                <MenuItem onClick={() => auth.signOut()}>Abmelden</MenuItem>
              </>
            )}
          </MenuList>
        </MenuPopover>
      </Menu>
    </header>
  );
}
