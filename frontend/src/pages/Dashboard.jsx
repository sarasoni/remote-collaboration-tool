import React from "react";
import { useSelector } from "react-redux";
import { MessageSquare, FileText, PenTool, Building2, FolderKanban, Calendar } from "lucide-react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import PageLayoutWrapper from "../components/ui/PageLayoutWrapper";
import CustomCard from "../components/ui/CustomCard";

export default function Dashboard() {
  const user = useSelector((state) => state.auth.user);

  const services = [
    {
      name: "Workspaces",
      description: "Manage your workspaces and collaborate on projects with your team.",
      icon: <Building2 size={32} className="text-indigo-600 dark:text-indigo-400" />,
      path: "/workspaces",
      color: "indigo"
    },
    {
      name: "Chatting",
      description: "Real-time chat with your teammates or friends.",
      icon: <MessageSquare size={32} className="text-blue-600 dark:text-blue-400" />,
      path: "/chat",
      color: "blue"
    },
    {
      name: "Documents",
      description: "Shareable documents for real-time collaboration.",
      icon: <FileText size={32} className="text-yellow-500 dark:text-yellow-400" />,
      path: "/documents",
      color: "yellow"
    },
    {
      name: "Whiteboard",
      description: "Collaborative whiteboard for brainstorming and notes.",
      icon: <PenTool size={32} className="text-pink-500 dark:text-pink-400" />,
      path: "/boards",
      color: "pink"
    },
    {
      name: "Projects",
      description: "Manage your projects and track progress with Kanban boards.",
      icon: <FolderKanban size={32} className="text-purple-600 dark:text-purple-400" />,
      path: "/projects",
      color: "purple"
    },
    {
      name: "Meetings",
      description: "Schedule and join virtual meetings with your team.",
      icon: <Calendar size={32} className="text-red-500 dark:text-red-400" />,
      path: "/meetings",
      color: "red"
    },
  ];

  return (
    <PageLayoutWrapper
      title={`Welcome back, ${user?.name || "User"}! 👋`}
      subtitle="Explore the amazing services we provide"
    >
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.2 }}
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-4 gap-4 sm:gap-6"
      >
        {services.map((service, index) => (
          <motion.div
            key={service.name}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 * index }}
            whileHover={{ scale: 1.02, y: -4 }}
            whileTap={{ scale: 0.98 }}
          >
            <Link to={service.path} className="block group">
              <CustomCard 
                variant="elevated" 
                className="h-full hover:shadow-xl transition-all duration-300 group-hover:border-indigo-200 dark:group-hover:border-indigo-800"
              >
                <div className="flex flex-col items-center text-center space-y-4">
                  <div className="p-3 rounded-full bg-gray-50 dark:bg-gray-700 group-hover:bg-indigo-50 dark:group-hover:bg-indigo-900/20 transition-colors duration-300">
                    {service.icon}
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-100 mb-2">
                      {service.name}
                    </h3>
                    <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
                      {service.description}
                    </p>
                  </div>
                </div>
              </CustomCard>
            </Link>
          </motion.div>
        ))}
      </motion.div>
    </PageLayoutWrapper>
  );
}
