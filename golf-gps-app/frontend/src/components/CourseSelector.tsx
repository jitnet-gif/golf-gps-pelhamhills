import React, { useState, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import axios from 'axios';

interface Course {
  id: string;
  name: string;
  location: string;
  holes: number;
  par: number;
}

interface CourseSelectorProps {
  onCourseSelect?: (course: Course) => void;
  compact?: boolean;
}

export const CourseSelector: React.FC<CourseSelectorProps> = ({
  onCourseSelect,
  compact = false,
}) => {
  const [courses, setCourses] = useState<Course[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { currentCourseId, setCurrentCourseId } = useAppStore();

  useEffect(() => {
    const fetchCourses = async () => {
      try {
        setIsLoading(true);
        const response = await axios.get('/api/courses');
        setCourses(response.data.courses || []);
        setError(null);
      } catch (err) {
        console.error('Failed to fetch courses:', err);
        setError('Failed to load courses');
        // Fallback courses for offline/demo
        setCourses([
          {
            id: '1',
            name: 'Example Golf Course',
            location: 'Example City',
            holes: 18,
            par: 72,
          },
        ]);
      } finally {
        setIsLoading(false);
      }
    };

    fetchCourses();
  }, []);

  const selectedCourse = courses.find((c) => c.id === currentCourseId);

  const handleSelectCourse = (course: Course) => {
    setCurrentCourseId(course.id);
    setIsOpen(false);
    onCourseSelect?.(course);
  };

  if (compact) {
    return (
      <div className="relative">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="w-full flex items-center justify-between px-3 py-2 bg-card border border-border rounded-lg hover:bg-accent transition-colors"
        >
          <div className="text-left">
            <div className="text-xs text-muted-foreground">Course</div>
            <div className="text-sm font-semibold truncate">
              {selectedCourse?.name || 'Select Course'}
            </div>
          </div>
          <ChevronDown
            className={`w-4 h-4 transition-transform ${
              isOpen ? 'rotate-180' : ''
            }`}
          />
        </button>

        {isOpen && (
          <div className="absolute top-full mt-1 w-full bg-card border border-border rounded-lg shadow-lg z-50 max-h-60 overflow-y-auto">
            {isLoading ? (
              <div className="p-3 text-center text-sm text-muted-foreground">
                Loading courses...
              </div>
            ) : error ? (
              <div className="p-3 text-center text-sm text-destructive">
                {error}
              </div>
            ) : (
              courses.map((course) => (
                <button
                  key={course.id}
                  onClick={() => handleSelectCourse(course)}
                  className={`w-full text-left px-3 py-2 hover:bg-accent transition-colors ${
                    selectedCourse?.id === course.id
                      ? 'bg-primary/10 text-primary'
                      : ''
                  }`}
                >
                  <div className="font-medium text-sm">{course.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {course.location} • {course.holes}H • Par {course.par}
                  </div>
                </button>
              ))
            )}
          </div>
        )}
      </div>
    );
  }

  // Full course selector
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Select Course</h2>

      {isLoading ? (
        <div className="text-center py-8 text-muted-foreground">
          Loading courses...
        </div>
      ) : error ? (
        <div className="text-center py-8 text-destructive">{error}</div>
      ) : (
        <div className="grid gap-3">
          {courses.map((course) => (
            <button
              key={course.id}
              onClick={() => handleSelectCourse(course)}
              className={`p-4 rounded-lg border-2 transition-all ${
                selectedCourse?.id === course.id
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-primary/50 bg-card'
              }`}
            >
              <div className="flex justify-between items-start">
                <div className="text-left">
                  <h3 className="font-semibold text-base">{course.name}</h3>
                  <p className="text-sm text-muted-foreground">
                    {course.location}
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-bold text-primary">
                    {course.holes}
                  </div>
                  <div className="text-xs text-muted-foreground">holes</div>
                </div>
              </div>
              <div className="mt-2 flex justify-between">
                <span className="text-sm font-medium">
                  Par {course.par}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
