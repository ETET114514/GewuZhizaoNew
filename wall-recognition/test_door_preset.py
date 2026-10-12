from copy import deepcopy
import unittest
import test_projects


class DoorPresetWorkflowTests(unittest.TestCase):
    setUp = test_projects.ProjectWorkflowTests.setUp
    tearDown = test_projects.ProjectWorkflowTests.tearDown
    post = test_projects.ProjectWorkflowTests.post
    save = test_projects.ProjectWorkflowTests.save

    def test_ordinary_door_preset_save_reopen_and_one_undo(self):
        before = deepcopy(self.doc)
        status, result = self.post('/api/edit-opening',dict(run_id='test',opening_id='O001',preset='ordinary_door_800'))
        self.assertEqual(status,200,result)
        self.assertEqual(result['history_size'],1)
        self.assertEqual(result['document']['openings'][0]['dimensions_mm']['width_mm'],800)
        name, _ = self.save()
        status, restored = self.post('/api/open-project',dict(project_id=name))
        self.assertEqual(status,200,restored)
        self.assertEqual(restored['document'],result['document'])
        self.assertEqual(self.post('/api/undo-edit',dict(run_id='test'))[1]['document'],before)
