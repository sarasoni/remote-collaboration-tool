import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSelector } from 'react-redux';
import { X, Users, UserPlus, UserMinus, Crown, Shield, User, MoreVertical, Search } from 'lucide-react';
import { toast } from 'react-hot-toast';
import Button from '../ui/Button';
import UserAvatar from '../ui/UserAvatar';
import { useChat } from '../../hook/useChat';
import { searchUsers } from '../../api/chatApi';

const GroupMembersModal = ({ isOpen, onClose, chatId, chatName }) => {
  const { user } = useSelector((state) => state.auth);

  const [showAddMembers, setShowAddMembers] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMembers, setSelectedMembers] = useState([]);
  const [showMemberMenu, setShowMemberMenu] = useState(null);

  const { data: membersData, isLoading, error } = useQuery({
    queryKey: ['groupMembers', chatId],
    queryFn: () => {
    },
    enabled: !!chatId,
    staleTime: 5 * 60 * 1000,
    cacheTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    onError: (error) => {
      console.error('Error loading members:', error);
    },
  });

  const members = membersData?.data?.data?.members || [];
  const isAdmin = membersData?.data?.data?.isAdmin || false;
  const userRole = membersData?.data?.data?.userRole || 'member';

  const { data: searchResults } = useQuery({
    queryKey: ['userSearch', searchQuery],
    queryFn: () => searchUsers({ query: searchQuery }),
    enabled: showAddMembers && searchQuery.length >= 2,
    staleTime: 60000,
  });

  const {
    addGroupMembers,
    removeGroupMember,
    updateMemberRole,
    leaveGroup,
    isAddingMembers,
    isLeavingGroup
  } = useChat();

  const handleAddMembers = () => {
    if (selectedMembers.length === 0) {
      toast.error('Please select at least one member to add');
      return;
    }

    const memberIds = selectedMembers.map(member => member._id);
    addGroupMembers({
      chatId,
      memberIds
    });
    setSelectedMembers([]);
    setShowAddMembers(false);
    setSearchQuery('');
  };

  const handleRemoveMember = (memberId) => {
    removeGroupMember({
      chatId,
      memberId
    });
    setShowMemberMenu(null);
  };

  const handleUpdateRole = (memberId, newRole) => {
    updateMemberRole({
      chatId,
      memberId,
      role: newRole
    });
    setShowMemberMenu(null);
  };

  const handleLeaveGroup = () => {
    leaveGroup(chatId);
    onClose();
  };

  const handleAddMember = (userToAdd) => {
    if (!selectedMembers.find(member => member._id === userToAdd._id)) {
      setSelectedMembers(prev => [...prev, userToAdd]);
    }
    setSearchQuery('');
  };

  const handleRemoveSelectedMember = (memberId) => {
    setSelectedMembers(prev => prev.filter(member => member._id !== memberId));
  };

  const getRoleIcon = (role) => {
    switch (role) {
      case 'owner':
        return <Crown className="w-4 h-4 text-yellow-500" />;
      case 'admin':
        return <Shield className="w-4 h-4 text-blue-500" />;
      default:
        return <User className="w-4 h-4 text-gray-500" />;
    }
  };

  const getRoleColor = (role) => {
    switch (role) {
      case 'owner':
        return 'text-yellow-600 bg-yellow-100 dark:text-yellow-400 dark:bg-yellow-900/20';
      case 'admin':
        return 'text-blue-600 bg-blue-100 dark:text-blue-400 dark:bg-blue-900/20';
      default:
        return 'text-gray-600 bg-gray-100 dark:text-gray-400 dark:bg-gray-900/20';
    }
  };

  const availableUsers = searchResults?.data?.data?.users || [];
  const filteredUsers = availableUsers.filter(user => 
    !members.some(member => member.user._id === user._id)
  );

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white/95 dark:bg-gray-800/95 backdrop-blur-md rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden border border-white/20 dark:border-gray-700/50">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <Users className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
            <div>
              <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">
                Group Members
              </h2>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {chatName} • {members.length} members
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
          >
            <X className="w-5 h-5 text-gray-600 dark:text-gray-400" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[calc(90vh-140px)]">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
            </div>
          ) : error ? (
            <div className="text-center py-8">
              <p className="text-red-500">Failed to load members</p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Add Members Section */}
              {isAdmin && (
                <div className="border-b border-gray-200 dark:border-gray-700 pb-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-medium text-gray-900 dark:text-gray-100">
                      Add Members
                    </h3>
                    <Button
                      onClick={() => setShowAddMembers(!showAddMembers)}
                      size="sm"
                      variant="outline"
                    >
                      <UserPlus className="w-4 h-4 mr-2" />
                      {showAddMembers ? 'Cancel' : 'Add Members'}
                    </Button>
                  </div>

                  {showAddMembers && (
                    <div className="space-y-3">
                      {/* Search */}

                      {/* Selected Members */}
                      {selectedMembers.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {selectedMembers.map((member) => (
                            <div
                              key={member._id}
                              className="flex items-center gap-2 bg-indigo-100 dark:bg-indigo-900/20 px-3 py-1 rounded-full"
                            >
                              <UserAvatar user={member} size="xs" />
                              <span className="text-sm font-medium text-indigo-700 dark:text-indigo-300">
                                {member.name}
                              </span>
                              <button
                                onClick={() => handleRemoveSelectedMember(member._id)}
                                className="p-1 hover:bg-indigo-200 dark:hover:bg-indigo-900/40 rounded-full transition-colors"
                              >
                                <UserMinus className="w-3 h-3 text-indigo-600 dark:text-indigo-400" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Search Results */}
                      {searchQuery.length >= 2 && (
                        <div className="max-h-40 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-lg">
                          {filteredUsers.length > 0 ? (
                            filteredUsers.map((user, index) => (
                              <div
                                key={user._id || `search-user-${index}`}
                                onClick={() => handleAddMember(user)}
                                className="flex items-center gap-3 p-3 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer border-b border-gray-100 dark:border-gray-600 last:border-b-0"
                              >
                                <UserAvatar user={user} size="sm" />
                                <div className="flex-1">
                                  <p className="font-medium text-gray-900 dark:text-gray-100">
                                    {user.name}
                                  </p>
                                  <p className="text-sm text-gray-500 dark:text-gray-400">
                                    {user.email}
                                  </p>
                                </div>
                                <UserPlus className="w-4 h-4 text-gray-400" />
                              </div>
                            ))
                          ) : (
                            <div className="p-3 text-center text-gray-500 dark:text-gray-400">
                              No users found
                            </div>
                          )}
                        </div>
                      )}

                      {/* Add Button */}
                      {selectedMembers.length > 0 && (
                        <Button
                          onClick={handleAddMembers}
                          disabled={isAddingMembers}
                          loading={isAddingMembers}
                          className="w-full"
                        >
                          Add {selectedMembers.length} Member{selectedMembers.length > 1 ? 's' : ''}
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Members List */}
              <div className="space-y-2">
                <h3 className="font-medium text-gray-900 dark:text-gray-100">
                  Members ({members.length})
                </h3>
                {members.length === 0 ? (
                  <div className="text-center py-8">
                    <div className="w-16 h-16 bg-gray-100 dark:bg-gray-700 rounded-full flex items-center justify-center mx-auto mb-4">
                      <Users className="w-8 h-8 text-gray-400" />
                    </div>
                    <p className="text-gray-500 dark:text-gray-400 mb-2">No members found</p>
                    <p className="text-sm text-gray-400 dark:text-gray-500">
                      This might be a loading issue. Please check the console for debugging information.
                    </p>
                    <button
                      onClick={() => window.location.reload()}
                      className="mt-3 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
                    >
                      Refresh Page
                    </button>
                  </div>
                ) : (
                  members.map((member, index) => (
                  <div
                    key={member.user?._id || `member-${index}`}
                    className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg"
                  >
                    <div className="flex items-center gap-3">
                      <UserAvatar user={member.user} size="md" />
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-gray-900 dark:text-gray-100">
                            {member.user.name}
                          </p>
                          {member.user._id === user._id && (
                            <span className="text-xs bg-green-100 dark:bg-green-900/20 text-green-600 dark:text-green-400 px-2 py-1 rounded-full">
                              You
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                          {member.user.email}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {/* Role Badge */}
                      <div className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${getRoleColor(member.role)}`}>
                        {getRoleIcon(member.role)}
                        <span className="capitalize">{member.role}</span>
                      </div>

                      {/* Actions Menu */}
                      {isAdmin && member.user._id !== user._id && (
                        <div className="relative">
                          <button
                            onClick={() => setShowMemberMenu(showMemberMenu === member.user._id ? null : member.user._id)}
                            className="p-1 hover:bg-gray-200 dark:hover:bg-gray-600 rounded transition-colors"
                          >
                            <MoreVertical className="w-4 h-4 text-gray-500" />
                          </button>

                          {showMemberMenu === member.user._id && (
                            <div className="absolute right-0 top-8 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-10 min-w-[160px]">
                              {/* Remove Member */}
                              {member.role !== 'owner' && (
                                <button
                                  onClick={() => handleRemoveMember(member.user._id)}
                                  className="w-full flex items-center gap-2 px-3 py-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 text-left"
                                >
                                  <UserMinus className="w-4 h-4" />
                                  Remove Member
                                </button>
                              )}

                              {/* Role Management (Owner only) */}
                              {userRole === 'owner' && member.role !== 'owner' && (
                                <>
                                  {member.role === 'member' ? (
                                    <button
                                      onClick={() => handleUpdateRole(member.user._id, 'admin')}
                                      className="w-full flex items-center gap-2 px-3 py-2 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 text-left"
                                    >
                                      <Shield className="w-4 h-4" />
                                      Make Admin
                                    </button>
                                  ) : (
                                    <button
                                      onClick={() => handleUpdateRole(member.user._id, 'member')}
                                      className="w-full flex items-center gap-2 px-3 py-2 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 text-left"
                                    >
                                      <User className="w-4 h-4" />
                                      Remove Admin
                                    </button>
                                  )}
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-6 border-t border-gray-200 dark:border-gray-700">
          <div className="text-sm text-gray-500 dark:text-gray-400">
            {userRole === 'owner' ? 'You are the group owner' : 
             userRole === 'admin' ? 'You are a group admin' : 
             'You are a group member'}
          </div>
          <div className="flex items-center gap-3">
            {userRole !== 'owner' && (
              <Button
                onClick={handleLeaveGroup}
                variant="outline"
                disabled={isLeavingGroup}
                loading={isLeavingGroup}
                className="text-red-600 border-red-300 hover:bg-red-50 dark:text-red-400 dark:border-red-700 dark:hover:bg-red-900/20"
              >
                Leave Group
              </Button>
            )}
            <Button onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default GroupMembersModal;
