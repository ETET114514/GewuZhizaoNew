"""Regression checks for the first detector, independent of the sample photo."""
import unittest

from PIL import Image, ImageDraw

from recognize_walls import detect_walls


class RecognitionTests(unittest.TestCase):
    def test_wall_geometry_and_door_gap(self):
        image = Image.new("RGB", (250, 160), "white")
        draw = ImageDraw.Draw(image)
        # A 20 px doorway must remain open between two 10 px thick walls.
        draw.rectangle((20, 20, 99, 29), fill=(125, 125, 125))
        draw.rectangle((120, 20, 219, 29), fill=(125, 125, 125))
        draw.rectangle((20, 50, 31, 139), fill=(140, 140, 140))
        walls = detect_walls(image)
        self.assertEqual(len(walls), 3)
        self.assertEqual(walls[0]["start_px"], [20.0, 25.0])
        self.assertEqual(walls[0]["end_px"], [100.0, 25.0])
        self.assertEqual(walls[0]["thickness_px"], 10)
        self.assertEqual(walls[1]["start_px"], [120.0, 25.0])
        self.assertEqual(walls[2]["start_px"], [26.0, 50.0])
        self.assertEqual(walls[2]["thickness_px"], 12)
        self.assertTrue(all(w["review_status"] == "unreviewed" for w in walls))

    def test_thin_furniture_lines_and_colored_floor_are_rejected(self):
        image = Image.new("RGB", (240, 180), "white")
        draw = ImageDraw.Draw(image)
        draw.rectangle((20, 20, 200, 22), fill="black")
        draw.rectangle((20, 60, 29, 160), fill=(110, 65, 40))
        self.assertEqual(detect_walls(image), [])

    def test_blank_image_and_image_boundary(self):
        image = Image.new("RGB", (140, 100), "white")
        self.assertEqual(detect_walls(image), [])
        ImageDraw.Draw(image).rectangle((0, 0, 99, 9), fill=(100, 100, 100))
        walls = detect_walls(image)
        self.assertEqual(len(walls), 1)
        self.assertEqual(walls[0]["bbox_px"], [0, 0, 100, 10])


if __name__ == "__main__":
    unittest.main()
