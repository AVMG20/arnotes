import { authClient } from './useAuth'

export interface TeamMember {
  id: string
  userId: string
  role: string
  user?: {
    name?: string
    email?: string
  }
}

export interface Team {
  id: string
  name: string
  slug: string
  joinCode?: string | null
  members?: TeamMember[]
}

export function useTeams() {
  const listOrgsRef = authClient.useListOrganizations()
  const activeOrgRef = authClient.useActiveOrganization()
  const { session } = useAuth()

  const teams = computed(() => (listOrgsRef.value.data ?? []) as unknown as Team[])
  const isPending = computed(() => listOrgsRef.value.isPending || activeOrgRef.value.isPending)

  // Active team/organization (null = Personal Workspace)
  const activeTeam = computed(() => (activeOrgRef.value.data ?? null) as unknown as Team | null)
  const activeTeamId = computed(() => activeTeam.value?.id ?? null)
  const activeTeamMembers = computed(() => activeTeam.value?.members ?? [])

  const currentMember = computed(() =>
    activeTeamMembers.value.find(m => m.userId === session.value?.user?.id) ?? null
  )
  const currentUserRole = computed(() => currentMember.value?.role ?? null)
  const isTeamOwner = computed(() => currentUserRole.value === 'owner')
  const isTeamAdmin = computed(() => currentUserRole.value === 'owner' || currentUserRole.value === 'admin')

  // Better Auth rejects a leave request from the only owner of a team that still
  // has other members — ownership has to be handed over first.
  const mustTransferBeforeLeaving = computed(() => {
    if (!isTeamOwner.value || activeTeamMembers.value.length <= 1) return false
    return activeTeamMembers.value.filter(m => m.role.split(',').includes('owner')).length <= 1
  })

  // Slugs are globally unique, so two teams named "Design" would collide. Callers
  // only ever supply a name, so a short random suffix keeps creation from failing.
  function slugify(name: string) {
    const base = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    const suffix = Math.random().toString(36).slice(2, 8)
    return base ? `${base}-${suffix}` : suffix
  }

  async function createTeam(name: string, slug?: string) {
    const res = await authClient.organization.create({
      name,
      slug: slug || slugify(name)
    })
    if (res.error) {
      throw new Error(res.error.message || 'Failed to create team')
    }
    if (res.data?.id) {
      await $fetch(`/api/teams/${res.data.id}/rotate-code`, { method: 'POST' })
      await setActiveTeam(res.data.id)
    }
    return res.data
  }

  async function setActiveTeam(organizationId: string | null) {
    await authClient.organization.setActive({ organizationId })
  }

  // The custom /api/teams endpoints bypass better-auth, so its cached queries do
  // not invalidate on their own and have to be refetched explicitly.
  async function refreshActiveTeam() {
    await activeOrgRef.value.refetch()
  }

  async function refreshTeamList() {
    await listOrgsRef.value.refetch()
  }

  async function updateTeamName(organizationId: string, name: string) {
    const res = await authClient.organization.update({
      organizationId,
      data: { name }
    })
    if (res.error) {
      throw new Error(res.error.message || 'Failed to update team name')
    }
    return res.data
  }

  async function rotateJoinCode(organizationId: string) {
    const res = await $fetch<{ joinCode: string }>(`/api/teams/${organizationId}/rotate-code`, { method: 'POST' })
    await refreshActiveTeam()
    return res.joinCode
  }

  async function removeMember(memberIdOrEmail: string) {
    if (!activeTeamId.value) throw new Error('No active team selected')
    const res = await authClient.organization.removeMember({
      memberIdOrEmail
    })
    if (res.error) {
      throw new Error(res.error.message || 'Failed to remove member')
    }
    return res.data
  }

  async function transferOwnership(memberId: string) {
    if (!activeTeamId.value) throw new Error('No active team selected')
    if (!currentMember.value) throw new Error('You are not a member of this team')

    const promote = await authClient.organization.updateMemberRole({
      memberId,
      role: 'owner',
      organizationId: activeTeamId.value
    })
    if (promote.error) {
      throw new Error(promote.error.message || 'Failed to transfer ownership')
    }

    const demote = await authClient.organization.updateMemberRole({
      memberId: currentMember.value.id,
      role: 'admin',
      organizationId: activeTeamId.value
    })
    if (demote.error) {
      throw new Error(demote.error.message || 'Ownership was transferred, but your own role could not be updated')
    }
  }

  async function leaveTeam(organizationId: string) {
    // If you're the only member, leaving means the team (and its notes, via cascade) is deleted.
    const isLastMember = activeTeamId.value === organizationId && activeTeamMembers.value.length === 1
    if (isLastMember) {
      return deleteTeam(organizationId)
    }

    const res = await authClient.organization.leave({
      organizationId
    })
    if (res.error) {
      throw new Error(res.error.message || 'Failed to leave team')
    }
    if (activeTeamId.value === organizationId) {
      await setActiveTeam(null)
    }
    return res.data
  }

  async function deleteTeam(organizationId: string) {
    const res = await authClient.organization.delete({
      organizationId
    })
    if (res.error) {
      throw new Error(res.error.message || 'Failed to delete team')
    }
    if (activeTeamId.value === organizationId) {
      await setActiveTeam(null)
    }
    return res.data
  }

  async function joinTeamWithCode(code: string) {
    const res = await $fetch<{ ok: boolean, organization: { id: string, name: string, slug: string } }>('/api/teams/join', {
      method: 'POST',
      body: { code }
    })
    if (res.organization?.id) {
      await setActiveTeam(res.organization.id)
      // Joining happens outside better-auth, so the org list has no idea a new
      // membership exists until it is refetched.
      await refreshTeamList()
    }
    return res.organization
  }

  return {
    teams,
    activeTeam,
    activeTeamId,
    activeTeamMembers,
    currentUserRole,
    isTeamOwner,
    isTeamAdmin,
    mustTransferBeforeLeaving,
    isPending,
    createTeam,
    setActiveTeam,
    refreshActiveTeam,
    refreshTeamList,
    updateTeamName,
    rotateJoinCode,
    removeMember,
    transferOwnership,
    leaveTeam,
    deleteTeam,
    joinTeamWithCode
  }
}
